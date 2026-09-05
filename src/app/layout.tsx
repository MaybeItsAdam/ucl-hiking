import type { Metadata } from "next";
import { NativeAuthBridge } from "@/components/NativeAuthBridge";
import "./globals.css";

export const metadata: Metadata = {
  title: "UCL Hiking Club — London out, wild in",
  description: "Weekend walks, mountain weekends and good company. Open to every UCL student.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <NativeAuthBridge />
        {children}
      </body>
    </html>
  );
}
