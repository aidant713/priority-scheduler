import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Priority Scheduler",
  description: "A drag-and-drop task list that auto-schedules into Google Calendar.",
  applicationName: "Priorities",
  appleWebApp: { capable: true, title: "Priorities", statusBarStyle: "default" },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#6366f1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
