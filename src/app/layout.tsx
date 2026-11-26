import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { LoginRolePrompt } from "@/components/auth/login-role-prompt";

export const metadata: Metadata = {
  title: "ParkSmart — Smart Parking & EV Charging Finder",
  description:
    "Discover real-time parking facilities and nearby EV charging stations, pre-order charging slots, and verify EV station owners securely.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-[#F4F7FB] text-slate-900 font-sans antialiased">
        <Navbar />
        <LoginRolePrompt />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
