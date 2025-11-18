import React from "react";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import ImageCropper from "./ImageCropper";
import A4Page from "./A4Page";
import PdfToJpeg from "./PdfToJpeg";
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
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
