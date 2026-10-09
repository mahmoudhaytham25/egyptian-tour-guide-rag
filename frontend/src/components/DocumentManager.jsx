// src/components/DocumentManager.jsx
import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const DocumentManager = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [indexingStatus, setIndexingStatus] = useState({});
  const [message, setMessage] = useState('');
  const [pollingActive, setPollingActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getDocuments();
      console.log("Fetched documents:", data.documents);
      setDocuments(data.documents || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      setMessage('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  const pollIndexingStatus = useCallback(() => {
    if (pollingActive) return;
    
    setPollingActive(true);
    console.log("Starting indexing status polling");
    
    const interval = setInterval(async () => {
      try {
        // Get indexing status from API
        const response = await api.getIndexingStatus();
        const status = response.status;
        console.log("Polling status:", status);
        
        if (status.isIndexing) {
          setStatusMessage(`Indexing in progress: ${status.progress}%`);
        } else if (status.lastIndexed) {
          // Indexing is complete, refresh document list
          await fetchDocuments();
          setStatusMessage(`Indexing completed at ${new Date(status.lastIndexed).toLocaleTimeString()}`);
          
          // Clear polling after a delay to let user see completion message
          setTimeout(() => {
            clearInterval(interval);
            setPollingActive(false);
            setStatusMessage('');
          }, 3000);
        }
      } catch (error) {
        console.error('Error polling status:', error);
        setStatusMessage('Error checking indexing status');
        clearInterval(interval);
        setPollingActive(false);
      }
    }, 2000);
    
    // Clean up interval if component unmounts
    return () => {
      clearInterval(interval);
      setPollingActive(false);
    };
  }, [pollingActive, fetchDocuments]);

  useEffect(() => {
    fetchDocuments();
    
    // Check if indexing is already in progress when component mounts
    const checkInitialStatus = async () => {
      try {
        const response = await api.getIndexingStatus();
        if (response.status.isIndexing) {
          pollIndexingStatus();
        }
      } catch (error) {
        console.error('Error checking initial indexing status:', error);
      }
    };
    
    checkInitialStatus();
  }, [fetchDocuments, pollIndexingStatus]);

  const handleIndexDocument = async (filename) => {
    setIndexingStatus(prev => ({ ...prev, [filename]: 'indexing' }));
    setMessage(`Starting indexing for ${filename}...`);
    
    try {
      await api.indexDocument(filename);
      setMessage(`Indexing process started for ${filename}`);
      // Start polling for updates
      pollIndexingStatus();
    } catch (error) {
      console.error('Error indexing document:', error);
      setMessage(`Error: ${error.response?.data?.message || 'Failed to start indexing'}`);
      setIndexingStatus(prev => ({ ...prev, [filename]: 'failed' }));
    }
  };

  if (loading && documents.length === 0) {
    return <div>Loading documents...</div>;
  }

  return (
    <div className="document-manager">
      <h2>Document Management</h2>
      
      {message && <p className="message">{message}</p>}
      {statusMessage && <p className="status-message">{statusMessage}</p>}
      
      <div className="document-sections">
        <div className="document-section">
          <h3>Uploaded Documents (Not Indexed)</h3>
          {documents.filter(doc => !doc.indexed).length === 0 ? (
            <p>No unindexed documents available.</p>
          ) : (
            <ul className="documents-list">
              {documents
                .filter(doc => !doc.indexed)
                .map((doc, index) => (
                  <li key={index} className="document-item">
                    <span className="document-name">{doc.originalName || doc.filename}</span>
                    <button 
                      onClick={() => handleIndexDocument(doc.filename)}
                      disabled={pollingActive || indexingStatus[doc.filename] === 'indexing'}
                      className="index-button"
                    >
                      {indexingStatus[doc.filename] === 'indexing' || pollingActive 
                        ? 'Indexing...' 
                        : 'Index Document'}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
        
        <div className="document-section">
          <h3>Indexed Documents</h3>
          {documents.filter(doc => doc.indexed).length === 0 ? (
            <p>No indexed documents available.</p>
          ) : (
            <ul className="documents-list">
              {documents
                .filter(doc => doc.indexed)
                .map((doc, index) => (
                  <li key={index} className="document-item indexed">
                    <span className="document-name">{doc.originalName || doc.filename}</span>
                    <span className="indexed-badge">Indexed</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentManager;
