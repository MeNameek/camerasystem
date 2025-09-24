const socket = io();

// elements
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const joinCode = document.getElementById("joinCode");
const userNameInput = document.getElementById("userName");
const roomDisplay = document.getElementById("roomDisplay");
const userList = document.getElementById("userList");
const sideList = document.getElementById("sideList");
const remoteVideo = document.getElementById("remoteVideo");
const camLabel = document.getElementById("camLabel");
const flipBtn = document.getElementById("flipBtn");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const fullscreenWrapper = document.getElementById("fullscreenWrapper");

// state
let role = null;
let room = null;
let localStream = null;
let cameraPc = null;
const hostPcs = {};
const hostStreams = {};
const hostVideos = {}; // store hidden video elements per camera
const candidateQueues = {};
let currentCameraId = null;
let cameraOrder = [];
let cameraIndex = 0;
let useFrontCamera = true;

// helpers
function setRoomText(text) { roomDisplay.textContent = text || ""; }
function isHost() { return role === "host"; }
function isCamera() { return role === "camera"; }

// copy code
copyCodeBtn.onclick = () => { if(room) navigator.clipboard.writeText(room).catch(()=>{}); }

// fullscreen
fullscreenBtn.onclick = () => {
  if(document.fullscreenElement) document.exitFullscreen();
  else fullscreenWrapper.requestFullscreen();
}

// prev / next camera
prevBtn.onclick = () => {
  if(cameraOrder.length===0) return;
  cameraIndex=(cameraIndex-1+cameraOrder.length)%cameraOrder.length;
  switchToCamera(cameraOrder[cameraIndex]);
}
nextBtn.onclick = () => {
  if(cameraOrder.length===0) return;
  cameraIndex=(cameraIndex+1)%cameraOrder.length;
  switchToCamera(cameraOrder[cameraIndex]);
}

// flip camera
flipBtn.onclick = async () => {
  if(!isCamera()) return;
  useFrontCamera = !useFrontCamera;
  if(!localStream||!cameraPc) return;
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:useFrontCamera?"user":"environment"}, audio:false
    });
    const newTrack = newStream.getVideoTracks()[0];
    const sender = cameraPc.getSenders().find(s=>s.track&&s.track.kind==="video");
    if(sender) await sender.replaceTrack(newTrack);
    localStream.getVideoTracks().forEach(t=>t.stop());
    localStream = newStream;
  } catch(e){console.error(e);}
}

// create lobby
createBtn.onclick = () => {
  role="host";
  room=Math.random().toString(36).substring(2,8).toUpperCase();
  const name = userNameInput.value.trim()||"Host";
  socket.emit("join",{room,name,role});
  setRoomText("Lobby code: "+room);
}

// join as camera
joinBtn.onclick = async () => {
  role="camera";
  room=joinCode.value.trim();
  if(!room) return alert("Enter lobby code");
  const name = userNameInput.value.trim()||"Camera";
  socket.emit("join",{room,name,role});
  try{
    localStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:useFrontCamera?"user":"environment"},audio:false});
    await startCameraPeer();
    setRoomText("Joined: "+room);
  }catch(e){console.error(e); alert("Camera permission failed")}
}

// camera side peer
async function startCameraPeer(){
  cameraPc = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  cameraPc.onicecandidate=e=>{ if(e.candidate) socket.emit("signal",{room,sdp:null,candidate:e.candidate}) }
  localStream.getTracks().forEach(track=>cameraPc.addTrack(track,localStream));
  const offer = await cameraPc.createOffer();
  await cameraPc.setLocalDescription(offer);
  socket.emit("signal",{room,sdp:cameraPc.localDescription,candidate:null});
}

// user-list update
socket.on("user-list", users => renderUserList(users||[]));

// signaling
socket.on("signal", async msg=>{
  const fromId = msg.from; if(!fromId) return;

  if(isCamera()){
    if(!cameraPc) return;
    if(msg.sdp) await cameraPc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    if(msg.candidate) await cameraPc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    return;
  }

  if(isHost()){
    const cameraId = fromId;
    if(!hostPcs[cameraId]) createHostPc(cameraId);
    const pc = hostPcs[cameraId];
    if(msg.sdp){
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal",{room,target:cameraId,sdp:pc.localDescription,candidate:null});
    } else if(msg.candidate){
      try{ await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); }
      catch(e){
        if(!candidateQueues[cameraId]) candidateQueues[cameraId]=[];
        candidateQueues[cameraId].push(msg.candidate);
      }
    }
  }
});

// host pc per camera
function createHostPc(cameraId){
  const pc = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  
  pc.onicecandidate = e => { if(e.candidate) socket.emit("signal",{room,target:cameraId,sdp:null,candidate:e.candidate}) }
  
  pc.ontrack = e => {
    let stream = e.streams[0];
    
    if(!hostVideos[cameraId]){
      const vid = document.createElement("video");
      vid.autoplay = true;
      vid.playsInline = true;
      vid.muted = false;
      vid.srcObject = stream;
      vid.style.display = "none";
      document.body.appendChild(vid); // keep alive
      hostVideos[cameraId] = vid;
    } else {
      hostVideos[cameraId].srcObject = stream;
    }

    hostStreams[cameraId] = stream;

    if(!currentCameraId) switchToCamera(cameraId);

    if(candidateQueues[cameraId] && candidateQueues[cameraId].length){
      candidateQueues[cameraId].forEach(async c => {
        try{ await pc.addIceCandidate(new RTCIceCandidate(c)) }catch{}
      });
      candidateQueues[cameraId]=[];
    }
  };

  hostPcs[cameraId]=pc;
  return pc;
}

// render user list
function renderUserList(users){
  userList.innerHTML="";
  cameraOrder=[];
  users.forEach(u=>{
    if(u.role==="camera"){
      const btn=document.createElement("div");
      btn.className="camera-btn";
      btn.dataset.id=u.id;
      btn.innerHTML=`<div class="camera-name">${escapeHtml(u.name)}</div><div class="camera-id">${u.id.slice(0,6)}</div>`;
      btn.onclick=()=>{ switchToCamera(u.id); cameraIndex=cameraOrder.indexOf(u.id); }
      userList.appendChild(btn);
      cameraOrder.push(u.id);
    }
  });
  updateActiveButtons();
}

// switch camera
function switchToCamera(cameraId){
  currentCameraId = cameraId;
  const vid = hostVideos[cameraId];
  if(vid){
    remoteVideo.srcObject = vid.srcObject;
    remoteVideo.play().catch(()=>{});
  } else {
    remoteVideo.srcObject = null;
    camLabel.textContent = "Connecting to "+cameraId.slice(0,6);
  }

  const btn = [...userList.children].find(n => n.dataset.id === cameraId);
  camLabel.textContent = btn ? btn.querySelector(".camera-name").textContent : "Camera "+cameraId.slice(0,6);
  updateActiveButtons();
}

// highlight active
function updateActiveButtons(){ Array.from(userList.children).forEach(el=>el.dataset.id===currentCameraId?el.classList.add("active"):el.classList.remove("active")); }

// escape helper
function escapeHtml(s){ if(!s) return ""; return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
