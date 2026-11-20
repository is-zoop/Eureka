import React from "react";
const wrapper = tag => function FixtureWrapper({ children, ...props }) { return React.createElement(tag, props, children); };
export const Dialog = wrapper("div");
export const DialogContent = wrapper("div");
export const DialogHeader = wrapper("header");
export const DialogTitle = wrapper("h2");
export const DialogDescription = wrapper("p");
export const DialogBody = wrapper("div");
export const DialogFooter = wrapper("footer");
