const { createServer } = require("http");
const { Server } = require("socket.io");

const port = process.env.PORT || 3002;

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Socket.io server is running 🚀");
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const onlineUsers = new Map();
const userSockets = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  const userId = socket.handshake.query.userId;
  if (userId) {
    onlineUsers.set(userId, {
      socketId: socket.id,
      lastSeen: new Date(),
      status: "online",
    });
    userSockets.set(socket.id, userId);
    socket.join(`user_${userId}`);

    // This tells everyone else that this user is now online
    socket.broadcast.emit("userOnline", userId);

    // NEW: Send the full list of online users ONLY to the newly connected client
    const onlineUserIds = Array.from(onlineUsers.keys());
    socket.emit("onlineUsersList", onlineUserIds);
  }

  socket.on("joinConversation", (conversationId) => {
    socket.join(conversationId);
    console.log(`User ${socket.id} joined room ${conversationId}`);
  });

  socket.on("sendMessage", (message) => {
    console.log("Message received:", message.content);
    const conversationId = message.conversationId || message.conversation?._id;
    if (conversationId) {
      socket.to(conversationId).emit("newMessage", message);
      console.log(`Message sent to room ${conversationId}`);
    }
  });

  socket.on("leaveConversation", (conversationId) => {
    socket.leave(conversationId);
    console.log(`User ${socket.id} left room ${conversationId}`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    const userId = userSockets.get(socket.id);
    if (userId) {
      onlineUsers.delete(userId);
      userSockets.delete(socket.id);
      socket.broadcast.emit("userOffline", userId);
    }
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
