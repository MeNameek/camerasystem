const socket = io();
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const joinCode = document.getElementById("joinCode");
const roomDisplay = document.getElementById("roomDisplay");
const remoteVideo = document.getElementById("remoteVideo");
const localVideo = document.getElementById("localVideo");
const fullscreenBtn = document.getElementById("fullscreenBtn");

let pc;
let room;

// Fullscreen button
fullscreenBtn.onclick = () => {
  if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
  else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
  else if (remoteVideo.msRequestFullscreen) remoteVideo.msRequestFullscreen();
};

// Create Lobby (Host)
createBtn.onclick = () => {
  room = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomDisplay.textContent = "Lobby Code: " + room;
  socket.emit("join", room);
  startHost();
};

// Join as Camera
joinBtn.onclick = async () => {
  room = joinCode.value.trim();
  if (!room) return;
  roomDisplay.textContent = "Joined room: " + room;
  socket.emit("join", room);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    localVideo.srcObject = stream;
    localVideo.style.display = "block"; // show small preview on device
    startCamera(stream);
  } catch (err) {
    alert("Camera access denied or failed: " + err.message);
    console.error(err);
  }
};

// Peer connection setup
function createPeerConnection() {
  const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  pc = new RTCPeerConnection(config);
  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { room, data: { candidate: e.candidate } });
  };
  pc.ontrack = e => {
    remoteVideo.srcObject = e.streams[0];
  };
}

// Host setup
function startHost() {
  createPeerConnection();
  socket.on("signal", async data => {
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { room, data: { sdp: pc.localDescription } });
    } else if (data.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  });
}

// Camera setup
async function startCamera(stream) {
  createPeerConnection();
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { room, data: { sdp: pc.localDescription } });
  socket.on("signal", async data => {
    if (data.sdp) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    else if (data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  });
}
