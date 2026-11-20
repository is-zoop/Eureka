// Render content without browser-only portals in static component assertions.
// Focus, dismissal and theme behavior are verified against the real Dialog in browser QA.
import React from "react";
export const Dialog = ({ children, open }) => open ? children : null;
export const DialogContent = ({ children }) => React.createElement("div", { role: "dialog" }, children);
export const DialogHeader = ({ children }) => React.createElement("header", null, children);
export const DialogTitle = ({ children }) => React.createElement("h2", null, children);
export const DialogBody = ({ children }) => React.createElement("div", null, children);
export const DialogFooter = ({ children }) => React.createElement("footer", null, children);
