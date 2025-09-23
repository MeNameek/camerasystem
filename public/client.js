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

let pc;
let room;
let stream;
let useFrontCamera = true;
let hostStreams = {}; // store all camera streams by socket ID
let currentCameraId = null;

// Fullscreen
fullscreenBtn.onclick = () => {
  if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
  else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
  else if (remoteVideo.msRequestFullscreen) remoteVideo.msRequestFullscreen();
};

// Flip camera button
flipBtn.onclick = async () => {
  if (!stream) return;
  useFrontCamera = !useFrontCamera;
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: useFrontCamera ? "user" : "environment" },
    audio: false
  });
  const videoTrack = newStream.getVideoTracks()[0];
  const sender = pc.getSenders().find(s => s.track.kind === "video");
  sender.replaceTrack(videoTrack);
  stream = newStream;
};

// Create Lobby (PC)
createBtn.onclick = () => {
  room = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomDisplay.textContent = "Lobby Code: " + room;
  const name = userNameInput.value.trim() || "Host";
  socket.emit("join", { room, name });
  startHost();
};

// Join as Camera (Mobile)
joinBtn.onclick = async () => {
  room = joinCode.value.trim();
  if (!room) return;
  roomDisplay.textContent = "Joined room: " + room;
  const name = userNameInput.value.trim() || "Camera";
  socket.emit("join", { room, name });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: useFrontCamera ? "user" : "environment" }, audio: false });
    startCamera(stream);
  } catch (err) {
    alert("Camera access denied or failed: " + err.message);
    console.error(err);
  }
};

// Update user list on host
socket.on("user-list", users => {
  userList.innerHTML = "";
  users.forEach(u => {
    if (u.id === socket.id && u.name.toLowerCase().includes("host")) return; // skip host
    const btn = document.createElement("button");
    btn.textContent = u.name;
    btn.className = "user-btn";
    btn.onclick = () => switchCamera(u.id);
    userList.appendChild(btn);
  });
});

// Switch camera on host
function switchCamera(cameraId) {
  if (hostStreams[cameraId]) {
    remoteVideo.srcObject = hostStreams[cameraId];
    currentCameraId = cameraId;
  }
}

// Create peer connection
function createPeerConnection(cameraId = null, isCamera = false) {
  const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  const connection = new RTCPeerConnection(config);

  connection.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { room, targetId: cameraId, data: { candidate: e.candidate } });
  };

  connection.ontrack = e => {
    if (!isCamera) { // host receiving camera
      hostStreams[cameraId] = e.streams[0];
      if (!currentCameraId) switchCamera(cameraId);
    }
  };

  return connection;
}

// Host setup
function startHost() {
  pc = createPeerConnection(); // host does not have local tracks
  socket.on("signal", async data => {
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { room, targetId: data.from, data: { sdp: pc.localDescription } });
    } else if (data.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  });
}

// Camera setup
async function startCamera(localStream) {
  pc = createPeerConnection(null, true);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { room, data: { sdp: pc.localDescription } });

  socket.on("signal", async data => {
    if (data.sdp) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    else if (data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  });
}
