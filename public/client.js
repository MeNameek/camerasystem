const socket = io();

const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const joinCode = document.getElementById("joinCode");
const roomDisplay = document.getElementById("roomDisplay");
const userNameInput = document.getElementById("userName");
const flipBtn = document.getElementById("flipBtn");
const copyCodeBtn = document.getElementById("copyCodeBtn");

const userList = document.getElementById("userList");
const remoteVideo = document.getElementById("remoteVideo");
const camLabel = document.getElementById("camLabel");
const fullscreenBtn = document.getElementById("fullscreenBtn");

let room;
let role;
let localStream;
let useFrontCamera = true;
let joined = false;
let pc;
let cameraStreams = {};
let currentCameraId = null;

// host UI
function updateCameraList(users) {
  userList.innerHTML = "";
  users.forEach(u => {
    if (u.role === "camera") {
      const btn = document.createElement("button");
      btn.textContent = u.name;
      btn.onclick = () => switchCamera(u.id, u.name);
      userList.appendChild(btn);
    }
  });
}

function switchCamera(id, name) {
  if (cameraStreams[id]) {
    remoteVideo.srcObject = cameraStreams[id];
    camLabel.textContent = name;
    currentCameraId = id;
  }
}

function setRoomText(txt) {
  roomDisplay.textContent = "Lobby: " + txt;
}

// Create lobby (host)
createBtn.onclick = () => {
  room = Math.random().toString(36).substring(2, 8).toUpperCase();
  const name = (userNameInput.value || "Host").trim();
  role = "host";
  socket.emit("join", { room, name, role });
  setRoomText(room);
  joined = true;
};

// Copy code
copyCodeBtn.onclick = () => {
  if (room) navigator.clipboard.writeText(room);
};

// Join as camera
joinBtn.onclick = async () => {
  if (joined) return;
  role = "camera";
  room = joinCode.value.trim();
  if (!room) return alert("Enter lobby code");
  const name = (userNameInput.value || "Camera").trim();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: useFrontCamera ? "user" : "environment" },
      audio: false
    });
  } catch (err) {
    alert("Camera permission denied. Enable camera and try again.");
    return;
  }

  // keep camera alive on iOS
  const tempVideo = document.createElement("video");
  tempVideo.style.display = "none";
  tempVideo.playsInline = true;
  tempVideo.muted = true;
  tempVideo.srcObject = localStream;
  document.body.appendChild(tempVideo);
  tempVideo.play().catch(()=>{});

  socket.emit("join", { room, name, role });
  setRoomText(room);
  joined = true;
  startCameraPeer();
};

// Flip camera
flipBtn.onclick = async () => {
  if (!localStream) return;
  useFrontCamera = !useFrontCamera;
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: useFrontCamera ? "user" : "environment" },
    audio: false
  });
  const videoTrack = newStream.getVideoTracks()[0];
  const sender = pc.getSenders().find(s => s.track.kind === "video");
  sender.replaceTrack(videoTrack);
  localStream = newStream;
};

// Fullscreen
fullscreenBtn.onclick = () => {
  const app = document.getElementById("app");
  if (app.requestFullscreen) app.requestFullscreen();
};

// Socket events
socket.on("user-list", updateCameraList);

socket.on("signal", async msg => {
  if (role === "host") {
    const { from, sdp, candidate } = msg;
    if (!cameraStreams[from]) {
      cameraStreams[from] = { pc: new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }) };
      const pcHost = cameraStreams[from].pc;

      pcHost.onicecandidate = e => {
        if (e.candidate) socket.emit("signal", { room, targetId: from, data: { candidate: e.candidate } });
      };

      pcHost.ontrack = e => {
        cameraStreams[from] = e.streams[0];
        if (!currentCameraId) switchCamera(from, "Camera");
      };
    }
    const pcHost = cameraStreams[from].pc;
    if (sdp) {
      await pcHost.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pcHost.createAnswer();
      await pcHost.setLocalDescription(answer);
      socket.emit("signal", { room, targetId: from, data: { sdp: pcHost.localDescription } });
    } else if (candidate) {
      await pcHost.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }
});

// Camera peer logic
async function startCameraPeer() {
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { room, data: { candidate: e.candidate } });
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { room, data: { sdp: pc.localDescription } });

  socket.on("signal", async msg => {
    if (msg.sdp) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    else if (msg.candidate) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
  });
}
