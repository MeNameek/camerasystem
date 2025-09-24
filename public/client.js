const socket = io();
let pc, localStream, isHost = false;
let currentCameraId = null;
let hostStreams = {}; // { cameraId : MediaStream }

const joinScreen = document.getElementById("joinScreen");
const hostScreen = document.getElementById("hostScreen");
const nameInput = document.getElementById("name");
const flipBtn = document.getElementById("flipBtn");
const remoteVideo = document.getElementById("remoteVideo");
const cameraButtons = document.getElementById("cameraButtons");

document.getElementById("joinHost").onclick = () => join(false);
document.getElementById("joinCamera").onclick = () => join(true);

async function join(asCamera) {
  const name = nameInput.value.trim() || (asCamera ? "Camera" : "Host");
  isHost = !asCamera;
  socket.emit("join", { name, isCamera: asCamera });
  joinScreen.classList.add("hidden");
  if (isHost) {
    hostScreen.classList.remove("hidden");
  } else {
    flipBtn.style.display = "block";
    startCamera(name);
  }
}

async function startCamera(name) {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  pc = createPeer(socket.id);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
}

flipBtn.onclick = async () => {
  if (!localStream) return;
  let cur = localStream.getVideoTracks()[0].getSettings().facingMode;
  let newMode = cur === "user" ? { facingMode: "environment" } : { facingMode: "user" };
  localStream.getTracks().forEach(t => t.stop());
  localStream = await navigator.mediaDevices.getUserMedia({ video: newMode, audio: false });
  pc.getSenders().find(s => s.track.kind === "video").replaceTrack(localStream.getVideoTracks()[0]);
};

// Host updates list of cameras
socket.on("cameraList", list => {
  if (!isHost) return;
  cameraButtons.innerHTML = "";
  list.forEach(cam => {
    let btn = document.createElement("button");
    btn.textContent = cam.name;
    btn.dataset.id = cam.id;
    btn.onclick = () => switchCamera(cam.id);
    cameraButtons.appendChild(btn);
  });
});

// Switch displayed camera
function switchCamera(id) {
  currentCameraId = id;
  document.querySelectorAll("#cameraButtons button").forEach(b => b.classList.toggle("active", b.dataset.id === id));
  if (hostStreams[id]) {
    remoteVideo.srcObject = hostStreams[id];
  } else {
    connectToCamera(id);
  }
}

function connectToCamera(cameraId) {
  const peer = createPeer(cameraId);
  peer.ontrack = e => {
    hostStreams[cameraId] = e.streams[0];
    if (currentCameraId === cameraId) remoteVideo.srcObject = hostStreams[cameraId];
  };
}

function createPeer(target) {
  const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  peer.onicecandidate = e => {
    if (e.candidate) socket.emit("ice-candidate", { target, candidate: e.candidate });
  };
  peer.onnegotiationneeded = async () => {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("offer", { target, offer, name: nameInput.value });
  };
  return peer;
}

socket.on("offer", async ({ from, offer, name }) => {
  if (isHost) return;
  pc = createPeer(from);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { target: from, answer });
});

socket.on("answer", async ({ from, answer }) => {
  const desc = new RTCSessionDescription(answer);
  await pc.setRemoteDescription(desc);
});

socket.on("ice-candidate", async ({ from, candidate }) => {
  if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
});
