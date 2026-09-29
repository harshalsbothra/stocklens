import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata={title:"StockLens — See the Market Clearly",description:"A calm, intelligent lens for understanding stocks and markets."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}