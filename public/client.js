const socket = io();
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const joinCode = document.getElementById("joinCode");
const roomDisplay = document.getElementById("roomDisplay");
const remoteVideo = document.getElementById("remoteVideo");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const flipBtn = document.getElementById("flipBtn");
const userNameInput = document.getElementById("userName");
const userList = document.getElementById("userList");
const cameraButtonsContainer = document.getElementById("cameraButtons");

let pcs = {}; // userId: RTCPeerConnection
let streams = {}; // userId: MediaStream
let room;
let stream;
let useFrontCamera = true;

// Fullscreen
fullscreenBtn.onclick = () => {
  if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
  else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
  else if (remoteVideo.msRequestFullscreen) remoteVideo.msRequestFullscreen();
};

// Flip camera
flipBtn.onclick = async () => {
  if (!stream) return;
  useFrontCamera = !useFrontCamera;
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: useFrontCamera ? "user" : "environment" },
    audio: false
  });
  const videoTrack = newStream.getVideoTracks()[0];
  const sender = pcs["local"].getSenders().find(s => s.track.kind === "video");
  sender.replaceTrack(videoTrack);
  stream = newStream;
};

// Create lobby (PC host)
createBtn.onclick = () => {
  room = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomDisplay.textContent = "Lobby Code: " + room;
  const name = userNameInput.value.trim() || "Host";
  socket.emit("join", { room, name });
  startHost();
};

// Join as camera (mobile)
joinBtn.onclick = async () => {
  room = joinCode.value.trim();
  if (!room) return;
  roomDisplay.textContent = "Joined room: " + room;
  const name = userNameInput.value.trim() || "Camera";
  socket.emit("join", { room, name });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: useFrontCamera ? "user" : "environment" },
      audio: false
    });
    startCamera(stream);
  } catch (err) {
    alert("Camera access denied or failed: " + err.message);
    console.error(err);
  }
};

// Update user list
socket.on("user-list", users => {
  userList.innerHTML = "";
  users.forEach(u => {
    const li = document.createElement("li");
    li.textContent = u.name;
    userList.appendChild(li);
  });
});

// Host: new camera joined
socket.on("peer-joined", ({ id, name }) => {
  startHostPeer(id, name);
});

// Function to start host for a new camera
function startHostPeer(id, name) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pcs[id] = pc;

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { room, target: id, data: { candidate: e.candidate } });
  };

  pc.ontrack = e => {
    streams[id] = e.streams[0];
    // If no main video yet, show this
    if (!remoteVideo.srcObject) remoteVideo.srcObject = e.streams[0];
    updateCameraButtons();
  };
}

// Update camera switch buttons
function updateCameraButtons() {
  cameraButtonsContainer.innerHTML = "";
  Object.entries(streams).forEach(([id, s]) => {
    const name = Object.keys(pcs).find(k => k === id) || "Camera";
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.onclick = () => remoteVideo.srcObject = streams[id];
    cameraButtonsContainer.appendChild(btn);
  });
}

// Camera setup
async function startCamera(localStream) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pcs["local"] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { room, data: { candidate: e.candidate } });
  };

  pc.ontrack = e => {
    // Usually not needed for camera devices
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { room, data: { sdp: pc.localDescription } });

  socket.on("signal", async data => {
    if (data.sdp) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    else if (data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  });
}

// Host setup
function startHost() {
  // nothing extra here; new cameras handled in peer-joined
}
