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
let pc; // camera peer connection
let hostStreams = {}; // host: cameraId -> MediaStream
let currentCameraId = null;

// Fullscreen button
fullscreenBtn.onclick = () => {
  if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
  else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
  else if (remoteVideo.msRequestFullscreen) remoteVideo.msRequestFullscreen();
};

// Flip camera (mobile)
flipBtn.onclick = async () => {
  if (!stream) return;
  useFrontCamera = !useFrontCamera;
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: useFrontCamera ? "user" : "environment" },
    audio: false
  });
  const videoTrack = newStream.getVideoTracks()[0];
  const sender = pc.getSenders().find(s => s.track.kind === "video");
  if (sender) sender.replaceTrack(videoTrack);
  stream = newStream;
};

// Host creates a lobby
createBtn.onclick = () => {
  room = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomDisplay.textContent = "Lobby Code: " + room;
  const name = userNameInput.value.trim() || "Host";
  socket.emit("join", { room, name });
};

// Camera joins lobby
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
    startCamera();
  } catch (err) {
    alert("Camera access denied or failed: " + err.message);
    console.error(err);
  }
};

// Host updates user buttons
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

// Switch camera feed on host
function switchCamera(cameraId) {
  if (hostStreams[cameraId]) {
    remoteVideo.srcObject = hostStreams[cameraId];
    currentCameraId = cameraId;
  }
}

// Camera (mobile) sets up peer connection
async function startCamera() {
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { room, data: { candidate: e.candidate } });
  };

  pc.ontrack = e => {
    // nothing for camera side
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { room, data: { sdp: pc.localDescription } });

  socket.on("signal", async data => {
    if (data.sdp) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    else if (data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  });
}

// Host receives camera streams
socket.on("signal", async data => {
  if (!data.from) return; // ignore signals not specifying sender

  if (!hostStreams[data.from]) hostStreams[data.from] = new MediaStream();
  if (!hostStreams[data.from].pc) {
    const pcHost = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    pcHost.onicecandidate = e => {
      if (e.candidate) socket.emit("signal", { room, targetId: data.from, data: { candidate: e.candidate } });
    };

    pcHost.ontrack = e => {
      hostStreams[data.from] = e.streams[0];
      if (!currentCameraId) switchCamera(data.from);
    };

    hostStreams[data.from].pc = pcHost;
  }

  const pcHost = hostStreams[data.from].pc;

  if (data.sdp) {
    await pcHost.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pcHost.createAnswer();
    await pcHost.setLocalDescription(answer);
    socket.emit("signal", { room, targetId: data.from, data: { sdp: pcHost.localDescription } });
  } else if (data.candidate) {
    await pcHost.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});
