// src/components/DocumentUploader.jsx
import { useRef, useState } from 'react';
import api from '../services/api';
import apiError from '../utils/apiError';

const DocumentUploader = ({ onDocumentUploaded }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

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
      // Older backends may not return a filename — fall back to the
      // selected file's name rather than printing 'undefined'.
      setMessage(`Document uploaded successfully: ${result.filename || file.name}`);

      // Important: Call this function to refresh document list
      if (onDocumentUploaded) {
        onDocumentUploaded();
      }
    } catch (error) {
      setMessage(`Error: ${apiError(error, 'Failed to upload document')}`);
    } finally {
      setUploading(false);
      setFile(null);
      // The input is uncontrolled — clear its value too so re-selecting
      // the same file fires a fresh change event.
      if (inputRef.current) {
        inputRef.current.value = '';
      }
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
            ref={inputRef}
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
