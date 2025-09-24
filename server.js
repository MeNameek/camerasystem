const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let cameras = {}; // { socket.id : { name, isCamera } }

io.on("connection", socket => {
  socket.on("join", ({ name, isCamera }) => {
    cameras[socket.id] = { name, isCamera };
    io.emit("cameraList", getCameraList());
  });

  socket.on("offer", ({ target, offer, name }) =>
    io.to(target).emit("offer", { from: socket.id, offer, name })
  );

  socket.on("answer", ({ target, answer }) =>
    io.to(target).emit("answer", { from: socket.id, answer })
  );

  socket.on("ice-candidate", ({ target, candidate }) =>
    io.to(target).emit("ice-candidate", { from: socket.id, candidate })
  );

  socket.on("disconnect", () => {
    delete cameras[socket.id];
    io.emit("cameraList", getCameraList());
  });
});

function getCameraList() {
  let list = [];
  for (let id in cameras) {
    if (cameras[id].isCamera) list.push({ id, name: cameras[id].name });
  }
  return list;
}

server.listen(3000, () => console.log("Server running on http://localhost:3000"));
