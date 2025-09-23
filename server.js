const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", socket => {
  socket.on("join", room => {
    socket.join(room);
    socket.to(room).emit("peer-joined");
  });

  socket.on("signal", ({ room, data }) => {
    socket.to(room).emit("signal", data);
  });
});

server.listen(3000, () => console.log("Server running on http://localhost:3000"));
