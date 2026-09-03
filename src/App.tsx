import React from "react";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import ImageCropper from "./ImageCropper";
import A4Page from "./A4Page";
import PdfToJpeg from "./PdfToJpeg";
import MrzReader from "./MrzReader";
import MergeToPdf from "./MergeToPdf";
import "./App.css";

function Navigation() {
  const location = useLocation();
  return (
    <nav style={{ 
      padding: "1rem 2rem", 
      background: "#0a0e1a", 
      borderBottom: "1px solid #203049",
      display: "flex",
      gap: "1rem"
    }}>
      <Link 
        to="/" 
        style={{ 
          color: location.pathname === "/" ? "#42b7ff" : "#7892b3",
          textDecoration: "none",
          fontWeight: location.pathname === "/" ? "bold" : "normal"
        }}
      >
        أداة قص وضغط الصور
      </Link>
      <Link 
        to="/a4" 
        style={{ 
          color: location.pathname === "/a4" ? "#42b7ff" : "#7892b3",
          textDecoration: "none",
          fontWeight: location.pathname === "/a4" ? "bold" : "normal"
        }}
      >
        جواز سفر قديم A4
      </Link>
      <Link 
        to="/pdf-to-jpeg" 
        style={{ 
          color: location.pathname === "/pdf-to-jpeg" ? "#42b7ff" : "#7892b3",
          textDecoration: "none",
          fontWeight: location.pathname === "/pdf-to-jpeg" ? "bold" : "normal"
        }}
      >
        PDF إلى JPEG
      </Link>
      <Link
        to="/mrz"
        style={{
          color: location.pathname === "/mrz" ? "#42b7ff" : "#7892b3",
          textDecoration: "none",
          fontWeight: location.pathname === "/mrz" ? "bold" : "normal"
        }}
      >
        قارئ بيانات الجواز (MRZ)
      </Link>
      <Link
        to="/merge-pdf"
        style={{
          color: location.pathname === "/merge-pdf" ? "#42b7ff" : "#7892b3",
          textDecoration: "none",
          fontWeight: location.pathname === "/merge-pdf" ? "bold" : "normal"
        }}
      >
        دمج ملفات وصور إلى PDF
      </Link>
    </nav>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <Navigation />
        <Routes>
          <Route path="/" element={<ImageCropper />} />
          <Route path="/a4" element={<A4Page />} />
          <Route path="/pdf-to-jpeg" element={<PdfToJpeg />} />
          <Route path="/mrz" element={<MrzReader />} />
          <Route path="/merge-pdf" element={<MergeToPdf />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
