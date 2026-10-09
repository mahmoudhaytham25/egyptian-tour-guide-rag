// src/components/DocumentUploader.jsx
import React, { useState } from 'react';
import api from '../services/api';

const DocumentUploader = ({ onDocumentUploaded }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
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
      setMessage(`Error: ${error.response?.data?.error || 'Failed to upload document'}`);
    } finally {
      setUploading(false);
      setFile(null);
    }
  };

  return (
    <div className="uploader-container">
      <h2>Upload Egyptian History Document</h2>
      <div className="upload-form">
        <input 
          type="file" 
          accept=".pdf" 
          onChange={handleFileChange} 
          disabled={uploading} 
        />
        <button 
          onClick={handleUpload} 
          disabled={!file || uploading}
        >
          {uploading ? 'Uploading...' : 'Upload Document'}
        </button>
      </div>
      {message && <p className="message">{message}</p>}
    </div>
  );
};

export default DocumentUploader;
