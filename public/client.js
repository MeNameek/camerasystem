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

// state
let role = null; // "host" or "camera"
let room = null;
let localStream = null;      // camera local stream (phone)
let cameraPc = null;         // camera peerconnection
const hostPcs = {};         // host: cameraId -> RTCPeerConnection
const hostStreams = {};     // host: cameraId -> MediaStream
const candidateQueues = {}; // candidate queue for host per camera if needed
let currentCameraId = null;
let cameraOrder = [];       // ordered list of camera ids for prev/next
let cameraIndex = 0;
let useFrontCamera = true;

// helpers
function setRoomText(text) {
  roomDisplay.textContent = text || "";
}

function isHost() { return role === "host"; }
function isCamera() { return role === "camera"; }

// copy code
copyCodeBtn.onclick = () => {
  if (!room) return;
  navigator.clipboard?.writeText(room).then(()=>{}, ()=>{});
};

// fullscreen
fullscreenBtn.onclick = () => {
  if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
  else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
  else if (remoteVideo.msRequestFullscreen) remoteVideo.msRequestFullscreen();
};

// prev / next camera
prevBtn.onclick = () => {
  if (cameraOrder.length === 0) return;
  cameraIndex = (cameraIndex - 1 + cameraOrder.length) % cameraOrder.length;
  const id = cameraOrder[cameraIndex];
  switchToCamera(id);
};

nextBtn.onclick = () => {
  if (cameraOrder.length === 0) return;
  cameraIndex = (cameraIndex + 1) % cameraOrder.length;
  const id = cameraOrder[cameraIndex];
  switchToCamera(id);
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
    // stop old video tracks and update localStream
    localStream.getVideoTracks().forEach(t => t.stop());
    localStream = newStream;
  } catch (err) {
    console.error("flip failed", err);
  }
};

// create lobby (host)
createBtn.onclick = () => {
  role = "host";
  room = Math.random().toString(36).substring(2,8).toUpperCase();
  const name = userNameInput.value.trim() || "Host";
  socket.emit("join", { room, name, role });
  setRoomText("Lobby code: " + room);
};

// join as camera (phone)
joinBtn.onclick = async () => {
  role = "camera";
  room = joinCode.value.trim();
  if (!room) return alert("Enter lobby code");
  const name = userNameInput.value.trim() || "Camera";
  socket.emit("join", { room, name, role });

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: useFrontCamera ? "user" : "environment" },
      audio: false
    });
    await startCameraPeer();
    setRoomText("Joined: " + room);
  } catch (err) {
    console.error(err);
    alert("Camera permission failed: " + (err && err.message));
  }
};

// start camera side peer
async function startCameraPeer() {
  cameraPc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  cameraPc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { room, sdp: null, candidate: e.candidate });
    }
  };

  // add tracks
  localStream.getTracks().forEach(track => cameraPc.addTrack(track, localStream));

  const offer = await cameraPc.createOffer();
  await cameraPc.setLocalDescription(offer);
  // send offer to room; server will forward to host(s)
  socket.emit("signal", { room, sdp: cameraPc.localDescription, candidate: null });
}

// socket user-list update
socket.on("user-list", users => {
  // update camera list panel on any client. host will show buttons for cameras.
  renderUserList(users || []);
});

// socket signal handler (both sides)
socket.on("signal", async message => {
  // message contains either sdp or candidate and message.from (sender socket id)
  const fromId = message.from;
  if (!fromId) return;

  // CAMERA role: expect answers and candidates from host
  if (isCamera()) {
    if (!cameraPc) {
      // no local pc yet. buffer candidate if any
      return;
    }
    if (message.sdp) {
      // host answer
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
        console.error("camera addIceCandidate", err);
      }
    }
    return;
  }

  // HOST role: host receives offers and candidates from cameras
  if (isHost()) {
    const cameraId = fromId;
    // ensure pc exists
    if (!hostPcs[cameraId]) createHostPc(cameraId);

    const pc = hostPcs[cameraId];

    if (message.sdp) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        // create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        // send answer back only to this camera
        socket.emit("signal", { room, target: cameraId, sdp: pc.localDescription, candidate: null });
      } catch (err) {
        console.error("host handle sdp failed", err);
      }
    } else if (message.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      } catch (err) {
        // if pc not ready, queue it
        if (!candidateQueues[cameraId]) candidateQueues[cameraId] = [];
        candidateQueues[cameraId].push(message.candidate);
      }
    }
  }
});

// create host pc per camera
function createHostPc(cameraId) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { room, target: cameraId, sdp: null, candidate: e.candidate });
    }
  };

  pc.ontrack = e => {
    // store the remote stream for switching
    hostStreams[cameraId] = e.streams[0];
    // if not selected, auto select the first connected camera
    if (!currentCameraId) {
      switchToCamera(cameraId);
    }
    // drain queue if present
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

// render user list and camera buttons
function renderUserList(users) {
  // show only cameras for host
  userList.innerHTML = "";
  cameraOrder = [];
  users.forEach(u => {
    if (u.role === "camera") {
      const btn = document.createElement("div");
      btn.className = "camera-btn";
      btn.dataset.id = u.id;
      btn.innerHTML = `<div class="camera-name">${escapeHtml(u.name)}</div>
                       <div class="camera-id">${u.id.slice(0,6)}</div>`;
      btn.onclick = () => {
        switchToCamera(u.id);
        // update index
        cameraIndex = cameraOrder.indexOf(u.id);
      };
      userList.appendChild(btn);
      cameraOrder.push(u.id);
    }
  });

  // update active highlight
  updateActiveButtons();
}

// switch host view to camera id
function switchToCamera(cameraId) {
  if (!hostStreams[cameraId]) {
    // if pc exists but stream not yet arrived, still create pc (if not) and wait
    if (!hostPcs[cameraId]) createHostPc(cameraId);
    currentCameraId = cameraId;
    camLabel.textContent = "Connecting to " + cameraId.slice(0,6);
    updateActiveButtons();
    return;
  }
  remoteVideo.srcObject = hostStreams[cameraId];
  currentCameraId = cameraId;
  // set camera label to name from user list UI
  const btn = [...userList.children].find(n => n.dataset.id === cameraId);
  camLabel.textContent = btn ? btn.querySelector(".camera-name").textContent : "Camera " + cameraId.slice(0,6);
  updateActiveButtons();
}

// highlight active button
function updateActiveButtons() {
  Array.from(userList.children).forEach(el => {
    if (el.dataset.id === currentCameraId) el.classList.add("active");
    else el.classList.remove("active");
  });
}

// escape helper
function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
