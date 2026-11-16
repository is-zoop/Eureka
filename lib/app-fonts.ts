import { JetBrains_Mono, Noto_Sans_Mono } from "next/font/google";

const notoSansMono = Noto_Sans_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-noto-mono", display: "swap" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });
export const fontVariableClasses = `${notoSansMono.variable} ${jetBrainsMono.variable}`;
