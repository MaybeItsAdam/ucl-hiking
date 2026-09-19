import type { Metadata } from "next";
import { NativeAuthBridge } from "@/components/NativeAuthBridge";
import { themeScript } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "UCL Hiking Club — London out, wild in",
  description: "Weekend walks, mountain weekends and good company. Open to every UCL student.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <NativeAuthBridge />
        {children}
      </body>
    </html>
  );
}
