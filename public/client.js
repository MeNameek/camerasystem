const socket = io();

// elements
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
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const appEl = document.getElementById("app");

// state
let role = null; // "host" or "camera"
let room = null;
let localStream = null;      // camera local stream (phone)
let cameraPc = null;         // camera peerconnection
const hostPcs = {};         // host: cameraId -> RTCPeerConnection
const hostStreams = {};     // host: cameraId -> MediaStream
const candidateQueues = {}; // candidate queue per camera
let currentCameraId = null;
let cameraOrder = [];       // ordered list of camera ids for prev/next
let cameraIndex = 0;
let useFrontCamera = true;
let joined = false;

// small helpers
function setRoomText(text) { roomDisplay.textContent = text || ""; }
function isHost() { return role === "host"; }
function isCamera() { return role === "camera"; }

function safePlayVideo() {
  if (!remoteVideo.srcObject) return;
  remoteVideo.play().catch(()=>{});
}

// copy code
copyCodeBtn.onclick = () => {
  if (!room) return;
  navigator.clipboard?.writeText(room).then(()=>{}, ()=>{});
};

// fullscreen: request fullscreen on the whole app so left panel stays visible
fullscreenBtn.onclick = () => {
  const target = appEl || document.documentElement;
  if (target.requestFullscreen) target.requestFullscreen();
  else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
  else if (target.msRequestFullscreen) target.msRequestFullscreen();
};

// prev / next camera
prevBtn.onclick = () => {
  if (cameraOrder.length === 0) return;
  cameraIndex = (cameraIndex - 1 + cameraOrder.length) % cameraOrder.length;
  switchToCamera(cameraOrder[cameraIndex]);
};

nextBtn.onclick = () => {
  if (cameraOrder.length === 0) return;
  cameraIndex = (cameraIndex + 1) % cameraOrder.length;
  switchToCamera(cameraOrder[cameraIndex]);
};

// flip camera on phone
flipBtn.onclick = async () => {
  if (!isCamera()) return;
  useFrontCamera = !useFrontCamera;
  if (!localStream || !cameraPc) return;
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: useFrontCamera ? "user" : "environment" },
      audio: false
    });
    const newTrack = newStream.getVideoTracks()[0];
    const sender = cameraPc.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) await sender.replaceTrack(newTrack);
    // stop old tracks
    localStream.getTracks().forEach(t => t.stop());
    localStream = newStream;
  } catch (err) {
    console.error("flip failed", err);
  }
};

// create lobby (host)
createBtn.onclick = () => {
  if (joined) return;
  role = "host";
  room = Math.random().toString(36).substring(2,8).toUpperCase();
  const name = (userNameInput.value || "Host").trim();
  socket.emit("join", { room, name, role });
  setRoomText("Lobby: " + room);
  joined = true;
};

// join as camera (phone)
joinBtn.onclick = async () => {
  if (joined) return;
  role = "camera";
  room = joinCode.value.trim();
  if (!room) return alert("Enter lobby code");
  const name = (userNameInput.value || "Camera").trim();
  // request camera first. if user denies, do not join
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: useFrontCamera ? "user" : "environment" },
      audio: false
    });
  } catch (err) {
    alert("Camera permission denied or failed. Allow camera and try again.");
    return;
  }
  // join room after camera permission granted
  socket.emit("join", { room, name, role });
  setRoomText("Joined: " + room);
  joined = true;
  startCameraPeer();
};

// render user list on host
socket.on("user-list", users => {
  // users is array [{id,name,role}]
  renderUserList(users || []);
  // cleanup host connections for removed cameras
  if (isHost()) cleanupHostConnections(users || []);
});

// handle signal messages
socket.on("signal", async message => {
  // message contains from, optional sdp and/or candidate
  if (!message || !message.from) return;
  const fromId = message.from;

  if (isCamera()) {
    // camera expects answers and candidates from host targeted to it
    if (!cameraPc) {
      // not ready yet. queue candidate if needed
      if (message.candidate) {
        if (!candidateQueues['camera']) candidateQueues['camera'] = [];
        candidateQueues['camera'].push(message.candidate);
      }
      return;
    }
    if (message.sdp) {
      try {
        await cameraPc.setRemoteDescription(new RTCSessionDescription(message.sdp));
      } catch (err) {
        console.error("camera setRemote failed", err);
      }
    }
    if (message.candidate) {
      try {
        await cameraPc.addIceCandidate(new RTCIceCandidate(message.candidate));
      } catch (err) {
        console.error("camera addIce failed", err);
      }
    }
    return;
  }

  if (isHost()) {
    // host receives offers and candidates from cameras
    const cameraId = fromId;
    if (!hostPcs[cameraId]) createHostPc(cameraId);

    const pc = hostPcs[cameraId];
    if (message.sdp) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        // send answer only to that camera
        socket.emit("signal", { room, target: cameraId, sdp: pc.localDescription, candidate: null });
      } catch (err) {
        console.error("host handle sdp failed", err);
      }
    } else if (message.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      } catch (err) {
        // queue it
        if (!candidateQueues[cameraId]) candidateQueues[cameraId] = [];
        candidateQueues[cameraId].push(message.candidate);
      }
    }
  }
});

// create and manage host RTCPeerConnection per camera
function createHostPc(cameraId) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { room, target: cameraId, sdp: null, candidate: e.candidate });
    }
  };

  pc.ontrack = e => {
    hostStreams[cameraId] = e.streams[0];
    // if no selection, auto select first
    if (!currentCameraId) {
      updateCameraOrder();
      switchToCamera(cameraId);
    }
    // drain candidate queue
    if (candidateQueues[cameraId] && candidateQueues[cameraId].length) {
      candidateQueues[cameraId].forEach(async c => {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (err) {}
      });
      candidateQueues[cameraId] = [];
    }
  };

  hostPcs[cameraId] = pc;
  return pc;
}

// start camera side peer connection and offer
async function startCameraPeer() {
  cameraPc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  cameraPc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { room, target: null, sdp: null, candidate: e.candidate });
    }
  };

  // add local tracks
  localStream.getTracks().forEach(track => cameraPc.addTrack(track, localStream));

  const offer = await cameraPc.createOffer();
  await cameraPc.setLocalDescription(offer);
  socket.emit("signal", { room, target: null, sdp: cameraPc.localDescription, candidate: null });

  // drain queued candidates for camera if any
  if (candidateQueues['camera'] && candidateQueues['camera'].length) {
    candidateQueues['camera'].forEach(async c => {
      try { await cameraPc.addIceCandidate(new RTCIceCandidate(c)); } catch (err) {}
    });
    candidateQueues['camera'] = [];
  }
}

// render camera list and buttons
function renderUserList(users) {
  userList.innerHTML = "";
  cameraOrder = [];
  users.forEach(u => {
    if (u.role === "camera") {
      const div = document.createElement("div");
      div.className = "camera-btn";
      div.dataset.id = u.id;
      div.innerHTML = `<div class="camera-name">${escapeHtml(u.name)}</div>
                       <div class="camera-id">${u.id.slice(0,6)}</div>`;
      div.onclick = () => {
        switchToCamera(u.id);
        cameraIndex = cameraOrder.indexOf(u.id);
      };
      userList.appendChild(div);
      cameraOrder.push(u.id);
    }
  });
  updateActiveButtons();
}

// update camera order from userList DOM
function updateCameraOrder() {
  cameraOrder = Array.from(userList.children).map(el => el.dataset.id);
}

// switch display to a camera id
function switchToCamera(cameraId) {
  if (!cameraId) return;
  if (hostStreams[cameraId]) {
    remoteVideo.srcObject = hostStreams[cameraId];
    safePlayVideo();
    currentCameraId = cameraId;
    // update label to show name
    const btn = [...userList.children].find(n => n.dataset.id === cameraId);
    camLabel.textContent = btn ? btn.querySelector(".camera-name").textContent : ("Camera " + cameraId.slice(0,6));
  } else {
    // stream not arrived yet. ensure pc exists so it can connect
    if (!hostPcs[cameraId]) createHostPc(cameraId);
    camLabel.textContent = "Connecting to " + cameraId.slice(0,6);
    currentCameraId = cameraId;
  }
  updateActiveButtons();
}

// highlight active button
function updateActiveButtons() {
  Array.from(userList.children).forEach(el => {
    if (el.dataset.id === currentCameraId) el.classList.add("active");
    else el.classList.remove("active");
  });
}

// cleanup host pcs for removed cameras
function cleanupHostConnections(users) {
  const currentCameraIds = new Set((users || []).filter(u => u.role === "camera").map(u => u.id));
  Object.keys(hostPcs).forEach(id => {
    if (!currentCameraIds.has(id)) {
      try { hostPcs[id].close(); } catch(e) {}
      delete hostPcs[id];
      delete hostStreams[id];
      delete candidateQueues[id];
    }
  });
  // remove from cameraOrder too
  cameraOrder = cameraOrder.filter(id => currentCameraIds.has(id));
  if (!cameraOrder.includes(currentCameraId)) {
    currentCameraId = cameraOrder[0] || null;
    if (currentCameraId) switchToCamera(currentCameraId);
    else {
      remoteVideo.srcObject = null;
      camLabel.textContent = "No camera selected";
    }
  }
  updateActiveButtons();
}

// HTML escape helper
function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
