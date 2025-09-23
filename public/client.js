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

let room;
let useFrontCamera = true;
let stream;
const hostConnections = {}; // key: cameraId, value: RTCPeerConnection
const hostStreams = {}; // key: cameraId, value: MediaStream
let currentCameraId = null;

// Fullscreen
fullscreenBtn.onclick = () => {
  if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
  else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
  else if (remoteVideo.msRequestFullscreen) remoteVideo.msRequestFullscreen();
};

// Flip camera button (for mobile)
flipBtn.onclick = async () => {
  if (!stream) return;
  useFrontCamera = !useFrontCamera;
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: useFrontCamera ? "user" : "environment" },
    audio: false
  });
  const videoTrack = newStream.getVideoTracks()[0];
  const sender = hostConnections["local"]?.getSenders().find(s => s.track.kind === "video");
  if (sender) sender.replaceTrack(videoTrack);
  stream = newStream;
};

// Create lobby (host/PC)
createBtn.onclick = () => {
  room = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomDisplay.textContent = "Lobby Code: " + room;
  const name = userNameInput.value.trim() || "Host";
  socket.emit("join", { room, name });
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

// Update user list on host
socket.on("user-list", users => {
  userList.innerHTML = "";
  users.forEach(u => {
    if (u.id === socket.id && u.name.toLowerCase().includes("host")) return; // skip host itself
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

// Host creates a peer connection for each camera
function createHostConnection(cameraId) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { room, targetId: cameraId, data: { candidate: e.candidate } });
    }
  };

  pc.ontrack = e => {
    hostStreams[cameraId] = e.streams[0];
    if (!currentCameraId) switchCamera(cameraId);
  };

  hostConnections[cameraId] = pc;
}

// Camera setup (mobile)
async function startCamera(localStream) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  stream = localStream;

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { room, data: { candidate: e.candidate } });
    }
  };

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { room, data: { sdp: pc.localDescription } });

  socket.on("signal", async data => {
    if (data.sdp) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    else if (data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  });
}

// Host receives camera offers
socket.on("signal", async data => {
  if (!data.from) return; // ignore signals not specifying sender
  if (!hostConnections[data.from]) createHostConnection(data.from);
  const pc = hostConnections[data.from];

  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", { room, targetId: data.from, data: { sdp: pc.localDescription } });
  } else if (data.candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});
