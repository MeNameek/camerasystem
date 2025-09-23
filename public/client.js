const socket = io();

const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const joinCode = document.getElementById("joinCode");
const userNameInput = document.getElementById("userName");
const roomDisplay = document.getElementById("roomDisplay");
const userList = document.getElementById("userList");
const remoteVideo = document.getElementById("remoteVideo");
const camLabel = document.getElementById("camLabel");
const flipBtn = document.getElementById("flipBtn");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");

let role = null;
let room = null;
let localStream = null;
let cameraPc = null;
const hostPcs = {};
const hostStreams = {};
let currentCameraId = null;
let cameraOrder = [];
let cameraIndex = 0;
let useFrontCamera = true;

// copy code
copyCodeBtn.onclick = ()=>{ if(!room) return; navigator.clipboard?.writeText(room); };

// fullscreen
fullscreenBtn.onclick = ()=>{ if(remoteVideo.requestFullscreen) remoteVideo.requestFullscreen(); };

// flip camera mobile
flipBtn.onclick = async ()=>{
  if(role!=="camera") return;
  useFrontCamera = !useFrontCamera;
  if(!localStream || !cameraPc) return;
  try{
    const newStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:useFrontCamera?"user":"environment"},audio:false});
    const track = newStream.getVideoTracks()[0];
    const sender = cameraPc.getSenders().find(s=>s.track.kind==="video");
    if(sender) sender.replaceTrack(track);
    localStream.getTracks().forEach(t=>t.stop());
    localStream = newStream;
  }catch(e){console.error(e);}
};

// create lobby
createBtn.onclick = ()=>{
  role="host";
  room = Math.random().toString(36).substring(2,8).toUpperCase();
  const name = userNameInput.value.trim()||"Host";
  socket.emit("join",{room,name,role});
  roomDisplay.textContent="Lobby code: "+room;
};

// join as camera
joinBtn.onclick = async ()=>{
  role="camera";
  room = joinCode.value.trim();
  if(!room) return alert("Enter code");
  const name = userNameInput.value.trim()||"Camera";
  // wait for camera permission first
  try{
    localStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:useFrontCamera?"user":"environment"},audio:false});
    cameraPc = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    localStream.getTracks().forEach(t=>cameraPc.addTrack(t,localStream));
    cameraPc.onicecandidate = e=>{ if(e.candidate) socket.emit("signal",{room,candidate:e.candidate}); };
    const offer = await cameraPc.createOffer();
    await cameraPc.setLocalDescription(offer);
    socket.emit("signal",{room,sdp:cameraPc.localDescription});
    socket.emit("join",{room,name,role});
    roomDisplay.textContent="Joined: "+room;
  }catch(e){ alert("Camera access denied or failed"); console.error(e);}
};

// socket handlers
socket.on("signal", async msg=>{
  const fromId = msg.from;
  if(role==="camera"){
    if(!cameraPc) return;
    if(msg.sdp) await cameraPc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    if(msg.candidate) await cameraPc.addIceCandidate(new RTCIceCandidate(msg.candidate));
  }
  if(role==="host"){
    if(!hostPcs[fromId]) createHostPc(fromId);
    const pc = hostPcs[fromId];
    if(msg.sdp){
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal",{room,target:fromId,sdp:pc.localDescription});
    }else if(msg.candidate){
      try{ await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); }catch(e){}
    }
  }
});

socket.on("user-list", users=>{
  if(role!=="host") return;
  renderUserList(users);
});

// create host pc per camera
function createHostPc(cameraId){
  const pc = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  pc.onicecandidate=e=>{ if(e.candidate) socket.emit("signal",{room,target:cameraId,candidate:e.candidate}); };
  pc.ontrack=e=>{
    hostStreams[cameraId]=e.streams[0];
    if(!currentCameraId) switchToCamera(cameraId);
  };
  hostPcs[cameraId]=pc;
}

// render buttons
function renderUserList(users){
  userList.innerHTML="";
  cameraOrder=[];
  users.forEach(u=>{
    if(u.role==="camera"){
      const btn=document.createElement("div");
      btn.className="camera-btn";
      btn.dataset.id=u.id;
      btn.innerHTML=`<div class="camera-name">${escapeHtml(u.name)}</div><div class="camera-id">${u.id.slice(0,6)}</div>`;
      btn.onclick=()=>{ switchToCamera(u.id); cameraIndex=cameraOrder.indexOf(u.id); };
      userList.appendChild(btn);
      cameraOrder.push(u.id);
    }
  });
  updateActiveButtons();
}

function switchToCamera(cameraId){
  if(!hostStreams[cameraId]){ camLabel.textContent="Connecting..."; currentCameraId=cameraId; updateActiveButtons(); return; }
  remoteVideo.srcObject = hostStreams[cameraId];
  currentCameraId = cameraId;
  const btn = [...userList.children].find(b=>b.dataset.id===cameraId);
  camLabel.textContent=btn?btn.querySelector(".camera-name").textContent:"Camera";
  updateActiveButtons();
}

function updateActiveButtons(){
  Array.from(userList.children).forEach(el=>{ el.classList.toggle("active",el.dataset.id===currentCameraId); });
}

function escapeHtml(s){ return s?s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]):""; }
