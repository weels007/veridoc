import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { StatusBar } from "@/components/StatusBar";
import { WalletProvider } from "@/lib/WalletContext";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "veridoc - Real-World KYC Verifier",
  description:
    "On-chain real-world KYC / claim verification powered by AI consensus on GenLayer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body>
        <WalletProvider>
          <div className="app-shell">
            <Header />
            <main className="app-main">{children}</main>
            <StatusBar />
          </div>
          <Toaster position="top-center" toastOptions={{ className: "office-toast" }} />
        </WalletProvider>
      </body>
    </html>
  );
}
