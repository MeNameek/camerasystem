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

let pcs = {};        // id -> RTCPeerConnection
let streams = {};    // id -> MediaStream
let localStream;
let room;
let useFrontCamera = true;

// Fullscreen
fullscreenBtn.onclick = () => {
  if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
};

// Flip camera
flipBtn.onclick = async () => {
  if (!localStream) return;
  useFrontCamera = !useFrontCamera;
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: useFrontCamera ? "user" : "environment" },
    audio: false
  });
  const sender = pcs["local"].getSenders().find(s => s.track.kind === "video");
  sender.replaceTrack(newStream.getVideoTracks()[0]);
  localStream = newStream;
};

// Host creates lobby
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

  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: useFrontCamera ? "user" : "environment" },
    audio: false
  });

  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pcs["local"] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { data: { candidate: e.candidate } });
  };

  socket.on("signal", async ({ from, data }) => {
    if (data.sdp) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    else if (data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { data: { sdp: pc.localDescription } });
};

// Host: new camera joined
socket.on("peer-joined", async ({ id, name }) => {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pcs[id] = pc;

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { target: id, data: { candidate: e.candidate } });
  };

  pc.ontrack = e => {
    streams[id] = e.streams[0];
    if (!remoteVideo.srcObject) remoteVideo.srcObject = e.streams[0];
    updateCameraButtons();
  };
});

// Host: handle incoming signals
socket.on("signal", async ({ from, data }) => {
  if (!pcs[from]) return;
  const pc = pcs[from];

  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { target: from, data: { sdp: pc.localDescription } });
    }
  } else if (data.candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

// Update camera switch buttons
function updateCameraButtons() {
  cameraButtonsContainer.innerHTML = "";
  Object.entries(streams).forEach(([id, s], i) => {
    const name = userList.children[i]?.textContent || "Camera";
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.onclick = () => remoteVideo.srcObject = s;
    cameraButtonsContainer.appendChild(btn);
  });
}

// Update user list
socket.on("user-list", users => {
  userList.innerHTML = "";
  users.forEach(u => {
    const li = document.createElement("li");
    li.textContent = u.name;
    userList.appendChild(li);
  });
});
