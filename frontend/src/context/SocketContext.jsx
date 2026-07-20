import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const isDev = import.meta.env.DEV;
    const socketUrl = isDev 
      ? window.location.origin.replace("5173", "5000") 
      : window.location.origin;

    const s = io(socketUrl, {
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => {
      setConnected(true);
      console.log("Socket connected");
    });

    s.on("disconnect", () => {
      setConnected(false);
    });

    setSocket(s);

    return () => s.disconnect();
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
