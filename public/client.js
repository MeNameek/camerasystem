const socket = io();
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const flipBtn = document.getElementById("flipBtn");
const roomDisplay = document.getElementById("roomDisplay");
const cameraListDiv = document.getElementById("cameraList");
const remoteVideo = document.getElementById("remoteVideo");
const camLabel = document.getElementById("camLabel");
const fullscreenBtn = document.getElementById("fullscreenBtn");

let room = null;
let isHost = false;
let useFront = false;
let localStream;
let pcs = {};
let currentCamera = null;

function randomRoom(){return Math.random().toString(36).substr(2,5).toUpperCase();}

createBtn.onclick = ()=>{
  room = randomRoom();
  isHost = true;
  socket.emit("create", room);
  roomDisplay.textContent = "Lobby: " + room;
};

flipBtn.onclick = ()=>{ useFront = !useFront; };

joinBtn.onclick = async ()=>{
  if (room) return;
  const code = document.getElementById("joinCode").value.trim();
  if (!code) return alert("Enter code");
  room = code;
  const name = document.getElementById("userName").value.trim() || "Camera";

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode: useFront ? "user" : "environment"},
      audio:false
    });
  } catch(e){
    alert("Camera blocked");
    return;
  }
  // keep camera alive right away
  const keep = document.createElement("video");
  keep.playsInline = true;
  keep.muted = true;
  keep.srcObject = localStream;
  keep.style.display="none";
  document.body.appendChild(keep);
  keep.play().catch(()=>{});

  socket.emit("join",{room,name});
  startCameraPeer();
};

socket.on("created", r=>{ room=r; });

socket.on("cameraList", list=>{
  cameraListDiv.innerHTML="";
  for(const [id,info] of Object.entries(list)){
    const btn=document.createElement("button");
    btn.className="camera-btn";
    btn.textContent=info.name;
    btn.onclick=()=>showCamera(id,info.name);
    cameraListDiv.appendChild(btn);
  }
});

socket.on("offer", async ({id,offer})=>{
  const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  pcs[id]=pc;
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("ice",{to:id,candidate:e.candidate});};
  pc.ontrack=e=>{
    if(currentCamera===id){
      remoteVideo.srcObject = e.streams[0];
    }
  };
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer",{id,answer});
});

socket.on("answer", async answer=>{
  const pc = pcs[socket.id];
  if(pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice", async ({from,candidate})=>{
  const pc = pcs[from] || pcs[socket.id];
  if(pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
});

socket.on("end", ()=>{
  alert("Host left");
  location.reload();
});

function showCamera(id,name){
  currentCamera = id;
  camLabel.textContent = name;
  const pc = pcs[id];
  if(pc){
    const stream = new MediaStream();
    pc.getReceivers().forEach(r=>{if(r.track)stream.addTrack(r.track);});
    remoteVideo.srcObject = stream;
  }
}

fullscreenBtn.onclick=()=>{
  if(!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
};

async function startCameraPeer(){
  const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  pcs[socket.id]=pc;
  localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.onicecandidate=e=>{
    if(e.candidate) socket.emit("ice",{to:null,candidate:e.candidate});
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer",{room,offer});
}
