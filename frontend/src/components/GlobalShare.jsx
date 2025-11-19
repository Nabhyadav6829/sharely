import React, { useState, useEffect } from "react";
import { Upload, Download, Copy, ExternalLink, File, CheckCircle } from "lucide-react";

export default function GlobalShare() {
  const [file, setFile] = useState(null);
  const [downloadLink, setDownloadLink] = useState("");
  const [mode, setMode] = useState("send"); // "send" or "receive"
  const [receiveLink, setReceiveLink] = useState("");
  const [receivedFileName, setReceivedFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    document.body.style.backgroundColor = '#121212';
    document.body.style.margin = '0';
    document.documentElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    return () => {
      document.body.style.backgroundColor = '';
      document.body.style.margin = '';
      document.documentElement.style.fontFamily = '';
    };
  }, []);

  const handleUpload = async () => {
    if (!file) return alert("Please select a file");

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploading(true);
      const res = await fetch("https://sharely-backend-fvi8.onrender.com", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setDownloadLink(data.url);
      console.log("Download link:", data.url);
    } catch (err) {
      console.error(err);
      alert("Upload failed!");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleReceive = () => {
    if (!receiveLink) return alert("Please paste the link");
    try {
      // Extract file name from URL
      const urlParts = receiveLink.split("/");
      const namePart = urlParts[urlParts.length - 1].split("?")[0]; // Remove query params
      setReceivedFileName(decodeURIComponent(namePart));
    } catch (err) {
      console.error(err);
      alert("Invalid link");
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(downloadLink).then(() => {
      alert("Link copied to clipboard!");
    }).catch(() => {
      alert("Failed to copy link.");
    });
  };

  const prettyBytes = (n) => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(1)} ${u[i]}`;
  };

  const styles = {
    pageContainer: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      padding: '20px',
      backgroundColor: '#121212',
      color: '#e0e0e0',
    },
    appContainer: {
      width: '100%',
      maxWidth: '680px',
      backgroundColor: '#1e1e1e',
      padding: '3rem',
      borderRadius: '20px',
      boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6), 0 0 80px rgba(187, 134, 252, 0.1)',
      border: '1px solid #333333',
      display: 'flex',
      flexDirection: 'column',
      gap: '28px',
      backdropFilter: 'blur(10px)',
    },
    header: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      borderBottom: '1px solid #333333',
      paddingBottom: '1.2rem',
    },
    title: {
      color: '#bb86fc',
      margin: '0',
      fontSize: '2.4rem',
      fontWeight: '700',
      textAlign: 'center',
      background: 'linear-gradient(135deg, #bb86fc 0%, #8e44ad 100%)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    },
    modeSelector: {
      display: 'flex',
      backgroundColor: '#333333',
      borderRadius: '12px',
      padding: '4px',
      gap: '4px',
    },
    modeButton: {
      flex: 1,
      padding: '12px 24px',
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
      fontWeight: '600',
      fontSize: '1rem',
      transition: 'all 0.3s ease',
      color: '#e0e0e0',
      backgroundColor: 'transparent',
    },
    modeButtonActive: {
      backgroundColor: '#8e44ad',
      color: '#ffffff',
      transform: 'translateY(-1px)',
    },
    input: {
      width: '100%',
      backgroundColor: '#333333',
      border: '1px solid #555555',
      color: '#e0e0e0',
      padding: '14px',
      borderRadius: '10px',
      fontSize: '1rem',
      boxSizing: 'border-box',
      transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      outline: 'none',
    },
    inputFocus: {
      borderColor: '#bb86fc',
      boxShadow: '0 0 8px rgba(187, 134, 252, 0.3)',
    },
    button: {
      width: '100%',
      backgroundColor: '#8e44ad',
      color: '#ffffff',
      border: 'none',
      padding: '14px 1.5rem',
      borderRadius: '10px',
      cursor: 'pointer',
      fontWeight: '600',
      fontSize: '1rem',
      transition: 'background-color 0.3s ease, transform 0.2s ease',
    },
    buttonHover: {
      backgroundColor: '#9b59b6',
      transform: 'translateY(-2px)',
    },
    buttonDisabled: {
      backgroundColor: '#4a4a4a',
      cursor: 'not-allowed',
      opacity: '0.6',
    },
    secondaryButton: {
      backgroundColor: '#03dac6',
      color: '#121212',
    },
    secondaryButtonHover: {
      backgroundColor: '#00c4b4',
    },
    copyButton: {
      backgroundColor: '#333333',
      border: '1px solid #555555',
      color: '#ffffff',
      padding: '8px 16px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontWeight: '600',
      fontSize: '0.9rem',
      transition: 'background-color 0.3s ease',
      marginLeft: '12px',
    },
    copyButtonHover: {
      backgroundColor: '#444444',
    },
    fileInputContainer: {
      border: '2px dashed #555555',
      borderRadius: '12px',
      padding: '40px 24px',
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      backgroundColor: '#2c2c2c',
      color: '#aaaaaa',
      minHeight: '140px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '12px',
      position: 'relative',
    },
    fileInputContainerHover: {
      borderColor: '#bb86fc',
      backgroundColor: 'rgba(187, 134, 252, 0.1)',
      transform: 'translateY(-2px)',
      boxShadow: '0 8px 24px rgba(187, 134, 252, 0.15)',
    },
    fileInput: {
      display: 'none',
    },
    linkContainer: {
      backgroundColor: '#2c2c2c',
      padding: '1.2rem',
      borderRadius: '10px',
      border: '1px solid #333333',
      marginTop: '16px',
    },
    linkTitle: {
      color: '#bb86fc',
      fontWeight: '600',
      marginBottom: '8px',
      fontSize: '0.95rem',
    },
    linkText: {
      color: '#03dac6',
      wordBreak: 'break-all',
      fontSize: '0.9rem',
      marginBottom: '12px',
    },
    progressContainer: {
      width: '100%',
      backgroundColor: '#333333',
      borderRadius: '6px',
      overflow: 'hidden',
      height: '14px',
      border: '1px solid #555555',
      marginTop: '12px',
    },
    progressBar: {
      height: '100%',
      backgroundColor: '#bb86fc',
      transition: 'width 0.3s ease-in-out',
    },
    filePreview: {
      backgroundColor: '#2c2c2c',
      padding: '1.2rem',
      borderRadius: '10px',
      border: '1px solid #333333',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: '16px',
    },
    fileInfo: {
      flex: 1,
    },
    fileName: {
      color: '#e0e0e0',
      fontWeight: '500',
      marginBottom: '4px',
    },
    fileSize: {
      color: '#aaaaaa',
      fontSize: '0.85rem',
    },
    downloadButton: {
      textDecoration: 'none',
      backgroundColor: '#03dac6',
      color: '#121212',
      padding: '10px 18px',
      borderRadius: '8px',
      fontWeight: '600',
      transition: 'background-color 0.3s ease, transform 0.2s ease',
    },
    downloadButtonHover: {
      backgroundColor: '#00c4b4',
      transform: 'translateY(-2px)',
    },
    uploadIcon: {
      width: '48px',
      height: '48px',
      color: '#bb86fc',
      marginBottom: '8px',
    },
    uploadText: {
      fontSize: '1.1rem',
      fontWeight: '500',
      color: '#e0e0e0',
      marginBottom: '4px',
    },
    uploadSubtext: {
      fontSize: '0.9rem',
      color: '#aaaaaa',
    },
    selectedFileContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px',
    },
    selectedFileIcon: {
      width: '40px',
      height: '40px',
      color: '#03dac6',
    },
    selectedFileInfo: {
      textAlign: 'center',
    },
    buttonIcon: {
      width: '20px',
      height: '20px',
      marginRight: '8px',
    },
    modeIcon: {
      width: '18px',
      height: '18px',
      marginRight: '8px',
    },
  };

  return (
    <div style={styles.pageContainer}>
      <div style={styles.appContainer}>
        <div style={styles.header}>
          <h1 style={styles.title}>Global File Share 🌐</h1>
        </div>

        {/* Mode Selector */}
        <div style={styles.modeSelector}>
          <button
            style={{
              ...styles.modeButton,
              ...(mode === "send" ? styles.modeButtonActive : {}),
            }}
            onClick={() => setMode("send")}
            onMouseOver={(e) => {
              if (mode !== "send") {
                e.target.style.backgroundColor = '#444444';
              }
            }}
            onMouseOut={(e) => {
              if (mode !== "send") {
                e.target.style.backgroundColor = 'transparent';
              }
            }}
          >
            <Upload style={styles.modeIcon} />
            Send File
          </button>
          <button
            style={{
              ...styles.modeButton,
              ...(mode === "receive" ? styles.modeButtonActive : {}),
            }}
            onClick={() => setMode("receive")}
            onMouseOver={(e) => {
              if (mode !== "receive") {
                e.target.style.backgroundColor = '#444444';
              }
            }}
            onMouseOut={(e) => {
              if (mode !== "receive") {
                e.target.style.backgroundColor = 'transparent';
              }
            }}
          >
            <Download style={styles.modeIcon} />
            Receive File
          </button>
        </div>

        {mode === "send" && (
          <>
            <label
              style={styles.fileInputContainer}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = styles.fileInputContainerHover.borderColor;
                e.currentTarget.style.backgroundColor = styles.fileInputContainerHover.backgroundColor;
                e.currentTarget.style.transform = styles.fileInputContainerHover.transform;
                e.currentTarget.style.boxShadow = styles.fileInputContainerHover.boxShadow;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = '#555555';
                e.currentTarget.style.backgroundColor = '#2c2c2c';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {file ? (
                <div style={styles.selectedFileContainer}>
                  <CheckCircle style={styles.selectedFileIcon} />
                  <div style={styles.selectedFileInfo}>
                    <div style={{ fontWeight: '600', marginBottom: '8px', color: '#03dac6' }}>File Selected!</div>
                    <div style={{ color: '#e0e0e0', fontWeight: '500' }}>{file.name}</div>
                    <div style={{ fontSize: '0.85rem', color: '#aaaaaa', marginTop: '4px' }}>
                      Size: {prettyBytes(file.size)}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <Upload style={styles.uploadIcon} />
                  <div style={styles.uploadText}>Click or Drag to Select File</div>
                  <div style={styles.uploadSubtext}>Support all file types • Maximum size 100MB</div>
                </>
              )}
              <input
                type="file"
                onChange={(e) => setFile(e.target.files[0])}
                style={styles.fileInput}
              />
            </label>

            <button
              style={{
                ...styles.button,
                ...(!file || uploading ? styles.buttonDisabled : {}),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={handleUpload}
              disabled={!file || uploading}
              onMouseOver={(e) => {
                if (!file || uploading) return;
                e.target.style.backgroundColor = styles.buttonHover.backgroundColor;
                e.target.style.transform = styles.buttonHover.transform;
              }}
              onMouseOut={(e) => {
                if (!file || uploading) return;
                e.target.style.backgroundColor = '#8e44ad';
                e.target.style.transform = 'none';
              }}
            >
              <Upload style={styles.buttonIcon} />
              {uploading ? `Uploading... ${uploadProgress}%` : 'Upload File'}
            </button>

            {uploading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={styles.progressContainer}>
                  <div style={{ ...styles.progressBar, width: `${uploadProgress}%` }}></div>
                </div>
                <span style={{ color: '#bb86fc', fontWeight: '500' }}>{uploadProgress}%</span>
              </div>
            )}

            {downloadLink && (
              <div style={styles.linkContainer}>
                <div style={styles.linkTitle}>Share this link:</div>
                <div style={styles.linkText}>{downloadLink}</div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    style={{
                      ...styles.copyButton,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onClick={copyToClipboard}
                    onMouseOver={(e) => (e.target.style.backgroundColor = styles.copyButtonHover.backgroundColor)}
                    onMouseOut={(e) => (e.target.style.backgroundColor = '#333333')}
                  >
                    <Copy style={{ width: '16px', height: '16px', marginRight: '6px' }} />
                    Copy Link
                  </button>
                  <a
                    href={downloadLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      ...styles.copyButton,
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      backgroundColor: '#03dac6',
                      color: '#121212',
                    }}
                    onMouseOver={(e) => (e.target.style.backgroundColor = '#00c4b4')}
                    onMouseOut={(e) => (e.target.style.backgroundColor = '#03dac6')}
                  >
                    <ExternalLink style={{ width: '16px', height: '16px', marginRight: '6px' }} />
                    Open Link
                  </a>
                </div>
              </div>
            )}
          </>
        )}

        {mode === "receive" && (
          <>
            <div style={styles.status}>
              Paste the file link below to download
            </div>
            
            <input
              type="text"
              placeholder="Paste the file link here..."
              value={receiveLink}
              onChange={(e) => setReceiveLink(e.target.value)}
              style={styles.input}
              onFocus={(e) => (e.target.style.borderColor = styles.inputFocus.borderColor)}
              onBlur={(e) => (e.target.style.borderColor = '#555555')}
            />
            
            <button
              style={{
                ...styles.button,
                ...styles.secondaryButton,
                ...(!receiveLink ? styles.buttonDisabled : {}),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={handleReceive}
              disabled={!receiveLink}
              onMouseOver={(e) => {
                if (!receiveLink) return;
                e.target.style.backgroundColor = styles.secondaryButtonHover.backgroundColor;
                e.target.style.transform = styles.buttonHover.transform;
              }}
              onMouseOut={(e) => {
                if (!receiveLink) return;
                e.target.style.backgroundColor = '#03dac6';
                e.target.style.transform = 'none';
              }}
            >
              <Download style={styles.buttonIcon} />
              Load File
            </button>

            {receivedFileName && (
              <div style={styles.filePreview}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  <File style={{ width: '24px', height: '24px', color: '#bb86fc' }} />
                  <div style={styles.fileInfo}>
                    <div style={styles.fileName}>{receivedFileName}</div>
                    <div style={styles.fileSize}>Ready to download</div>
                  </div>
                </div>
                <a
                  href={receiveLink}
                  download={receivedFileName}
                  style={{
                    ...styles.downloadButton,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseOver={(e) => {
                    e.target.style.backgroundColor = styles.downloadButtonHover.backgroundColor;
                    e.target.style.transform = styles.downloadButtonHover.transform;
                  }}
                  onMouseOut={(e) => {
                    e.target.style.backgroundColor = '#03dac6';
                    e.target.style.transform = 'none';
                  }}
                >
                  <Download style={{ width: '16px', height: '16px', marginRight: '6px' }} />
                  Download
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
