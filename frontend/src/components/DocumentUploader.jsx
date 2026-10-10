// src/components/DocumentUploader.jsx
import React, { useState } from 'react';
import api from '../services/api';

const DocumentUploader = ({ onDocumentUploaded }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = (e) => {
    setFile(e.target.files[0] || null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage('Please select a file first');
      return;
    }

    setUploading(true);
    setMessage('Uploading document...');

    try {
      const result = await api.uploadDocument(file);
      setMessage(`Document uploaded successfully: ${result.filename}`);

      // Important: Call this function to refresh document list
      if (onDocumentUploaded) {
        onDocumentUploaded();
      }
    } catch (error) {
      setMessage(`Error: ${error.response?.data?.message || 'Failed to upload document'}`);
    } finally {
      setUploading(false);
      setFile(null);
    }
  };

  return (
    <div className="uploader-container">
      <h3>Upload Egyptian History Document</h3>
      <div className="upload-form">
        <label
          className={`dropzone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            disabled={uploading}
            className="dropzone-input"
          />
          <span className="dropzone-icon" aria-hidden="true">📄</span>
          <span className="dropzone-text">
            {file ? file.name : 'Click to choose a PDF, or drop it here'}
          </span>
        </label>
        <button
          type="button"
          className="kb-button kb-button-primary"
          onClick={handleUpload}
          disabled={!file || uploading}
        >
          {uploading ? 'Uploading...' : 'Upload Document'}
        </button>
      </div>
      {message && <p className="dm-message">{message}</p>}
    </div>
  );
};

export default DocumentUploader;
