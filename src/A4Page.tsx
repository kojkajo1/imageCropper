import React, { useState } from "react";
import OldPassport from "./OldPassport";

export default function A4Page() {
  const [fileName, setFileName] = useState("document");

    return (
      <OldPassport
        fileName={fileName}
        onFileNameChange={setFileName}
      onComplete={() => {}}
    />
  );
}

