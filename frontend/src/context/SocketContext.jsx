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

      // The backend now requires a valid admin JWT to open a socket, so send the
      // session token on the handshake.
      const token = sessionStorage.getItem("token") || localStorage.getItem("token");

      s = io(socketUrl, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        auth: { token },
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
