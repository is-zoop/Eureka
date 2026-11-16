import React from "react";

// Keep image content observable in plain Node component tests without Next's loader.
export default function Image({ src, alt, width, height, className }) {
  return React.createElement("img", { src, alt, width, height, className });
}
