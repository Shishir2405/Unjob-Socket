// server.js
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = process.env.PORT || 3000;

// --- Initialize Next.js App ---
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// --- In-Memory Storage for User Status ---
// Replaces Redis for a simpler, single-server setup
const onlineUsers = new Map(); // Stores { userId: { socketId, status } }
const userSockets = new Map(); // Stores { socketId: userId }

app.prepare().then(() => {
  // --- Create HTTP Server for Next.js ---
  const server = createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error handling request:", err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  // --- Attach Socket.IO to the same HTTP server ---
  const io = new Server(server, {
    cors: {
      origin: "*", // Adjust for production
      methods: ["GET", "POST"],
    },
  });

  // --- Socket.IO Connection Logic (In-Memory) ---
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);
    const userId = socket.handshake.query.userId;

    if (userId) {
      // Store user's online status in memory
      onlineUsers.set(userId, {
        socketId: socket.id,
        status: "online",
      });
      userSockets.set(socket.id, userId);

      // Tell all OTHER clients that this user is now online
      socket.broadcast.emit("userOnline", userId);

      // Send the full list of currently online users to the new client
      const onlineUserIds = Array.from(onlineUsers.keys());
      socket.emit("onlineUsersList", onlineUserIds);
    }

    // --- Handle Real-time Events ---
    socket.on("joinConversation", (conversationId) => {
      socket.join(conversationId);
      console.log(`Socket ${socket.id} (User: ${userId}) joined conversation: ${conversationId}`);
    });

    socket.on("leaveConversation", (conversationId) => {
      socket.leave(conversationId);
      console.log(`Socket ${socket.id} (User: ${userId}) left conversation: ${conversationId}`);
    });

    socket.on("sendMessage", (message) => {
      const conversationId = message.conversationId;
      if (conversationId) {
        // Send message to all clients in the conversation room except the sender
        socket.to(conversationId).emit("newMessage", message);
      }
    });

    socket.on("startTyping", ({ conversationId, userId }) => {
      socket.to(conversationId).emit("startTyping", { conversationId, userId });
    });

    socket.on("stopTyping", ({ conversationId, userId }) => {
      socket.to(conversationId).emit("stopTyping", { conversationId, userId });
    });

    // --- Handle Disconnection ---
    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`);
      const disconnectedUserId = userSockets.get(socket.id);
      if (disconnectedUserId) {
        // Remove user from in-memory stores
        onlineUsers.delete(disconnectedUserId);
        userSockets.delete(socket.id);

        // Announce user offline status to all other clients
        socket.broadcast.emit("userOffline", disconnectedUserId);
      }
    });
  });

  // --- Start the Server ---
  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port} 🚀`);
  });
});