import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CV System",
  description: "Local-only, offline CV ranking system",
};

const THEME_STORAGE_KEY = "cv-system-theme";

const themeInitScript = `
(() => {
  try {
    const stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    const theme = stored === "light" ? "light" : "dark";
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  } catch {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr-TN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
