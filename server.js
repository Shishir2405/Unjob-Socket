// socketServer.js
import { createServer } from "http";
import { Server } from "socket.io";

/**
 * -----------------------------------------------------------------------------
 * SERVER CONFIGURATION
 * -----------------------------------------------------------------------------
 */
const port = process.env.PORT || 3001;
const startTime = new Date();

/**
 * A simple structured logger to make server output more readable.
 * @param {'INFO' | 'WARN' | 'ERROR'} level - The log level.
 * @param {string} context - The context of the log (e.g., 'Connection', 'Message').
 * @param {string} message - The log message.
 */
const log = (level, context, message) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} [${level}] [${context}] - ${message}`);
};

/**
 * -----------------------------------------------------------------------------
 * HTTP SERVER SETUP
 * -----------------------------------------------------------------------------
 */
const httpServer = createServer((req, res) => {
  // Enhanced health check endpoint
  if (req.url === "/api/health") {
    const uptimeInSeconds = Math.floor((new Date() - startTime) / 1000);
    const healthStatus = {
      status: "ok",
      timestamp: new Date(),
      uptime: `${uptimeInSeconds} seconds`,
      connectedClients: io.engine.clientsCount,
      onlineUsers: onlineUsers.size,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(healthStatus));
  } else {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Socket.IO Server is running 🚀");
  }
});

/**
 * -----------------------------------------------------------------------------
 * SOCKET.IO SERVER SETUP
 * -----------------------------------------------------------------------------
 */
const io = new Server(httpServer, {
  cors: {
    origin: "*", // For production, change this to your frontend's URL: 'https://your-frontend.com'
    methods: ["GET", "POST"],
  },
});

// In-memory storage for user status
const onlineUsers = new Map(); // Stores { userId: { socketId, status } }
const userSockets = new Map(); // Stores { socketId: userId }

/**
 * -----------------------------------------------------------------------------
 * SOCKET.IO CONNECTION LOGIC
 * -----------------------------------------------------------------------------
 */
io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId;
  log(
    "INFO",
    "Connection",
    `User connected: ${socket.id} (User ID: ${userId || "N/A"})`
  );

  if (userId) {
    onlineUsers.set(userId, { socketId: socket.id, status: "online" });
    userSockets.set(socket.id, userId);

    log("INFO", "Status", `User ${userId} is now online.`);
    socket.broadcast.emit("userOnline", userId);

    const onlineUserIds = Array.from(onlineUsers.keys());
    socket.emit("onlineUsersList", onlineUserIds);
  }

  // --- Event Handlers ---
  socket.on("joinConversation", (conversationId) => {
    socket.join(conversationId);
    log(
      "INFO",
      "Room",
      `User ${userId} (${socket.id}) joined conversation: ${conversationId}`
    );
  });

  socket.on("sendMessage", (message) => {
    const { conversationId } = message;
    if (conversationId) {
      log(
        "INFO",
        "Message",
        `Relaying message from ${userId} to conversation: ${conversationId}`
      );
      socket.to(conversationId).emit("newMessage", message);
    }
  });

  socket.on("startTyping", ({ conversationId, userId }) => {
    log(
      "INFO",
      "Typing",
      `User ${userId} started typing in conversation: ${conversationId}`
    );
    socket.to(conversationId).emit("startTyping", { conversationId, userId });
  });

  socket.on("stopTyping", ({ conversationId, userId }) => {
    log(
      "INFO",
      "Typing",
      `User ${userId} stopped typing in conversation: ${conversationId}`
    );
    socket.to(conversationId).emit("stopTyping", { conversationId, userId });
  });

  // --- Error and Disconnect Handlers ---
  socket.on("error", (err) => {
    log(
      "ERROR",
      "Socket",
      `Socket error for user ${userId} (${socket.id}): ${err.message}`
    );
  });

  socket.on("disconnect", (reason) => {
    log(
      "INFO",
      "Connection",
      `User disconnected: ${socket.id}. Reason: ${reason}`
    );
    const disconnectedUserId = userSockets.get(socket.id);
    if (disconnectedUserId) {
      onlineUsers.delete(disconnectedUserId);
      userSockets.delete(socket.id);
      log("INFO", "Status", `User ${disconnectedUserId} is now offline.`);
      socket.broadcast.emit("userOffline", disconnectedUserId);
    }
  });
});

/**
 * -----------------------------------------------------------------------------
 * START SERVER AND HANDLE SHUTDOWN
 * -----------------------------------------------------------------------------
 */
httpServer.listen(port, () => {
  log("INFO", "Server", `Server is listening on port ${port}`);
});

const shutdown = () => {
  log("INFO", "Server", "Shutting down gracefully...");
  io.close(() => {
    log("INFO", "Server", "All Socket.IO connections closed.");
  });
  httpServer.close(() => {
    log("INFO", "Server", "HTTP server closed.");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown); // Handle Ctrl+C
process.on("SIGTERM", shutdown); // Handle `kill` commands
