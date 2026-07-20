import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let s = null;
    try {
      const rawUrl = import.meta.env.VITE_API_URL || "https://onegrasp-backend.onrender.com";
      const socketUrl = rawUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");

      s = io(socketUrl, {
        transports: ["polling", "websocket"],
        reconnectionAttempts: 3,
        timeout: 5000,
      });

      s.on("connect", () => {
        setConnected(true);
      });

      s.on("disconnect", () => {
        setConnected(false);
      });

      setSocket(s);
    } catch (err) {
      console.warn("Socket initialization skipped:", err);
    }

    return () => {
      if (s) s.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
