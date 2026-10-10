// src/components/DocumentManager.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';

const DocumentManager = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [indexingStatus, setIndexingStatus] = useState({});
  const [message, setMessage] = useState('');
  const [pollingActive, setPollingActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  // The "clear status after 3s" timeout — tracked so it can't fire after
  // unmount (or stack up when indexing completes more than once).
  const statusTimeoutRef = useRef(null);
  const clearStatusSoon = useCallback(() => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = setTimeout(() => {
      statusTimeoutRef.current = null;
      setStatusMessage('');
    }, 3000);
  }, []);

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getDocuments();
      const docs = data.documents || [];
      setDocuments(docs);
      // A document that now reports indexed no longer needs its local
      // 'indexing'/'failed' status entry.
      setIndexingStatus((prev) => {
        const next = { ...prev };
        docs.forEach((doc) => {
          if (doc.indexed) delete next[doc.filename];
        });
        return next;
      });
    } catch (error) {
      console.error('Error fetching documents:', error);
      setMessage('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  // Start polling for indexing status (the effect below owns the interval)
  const pollIndexingStatus = useCallback(() => {
    setPollingActive(true);
  }, []);

  // Poll indexing status while polling is active.
  // The interval is created inside useEffect so its cleanup runs on unmount
  // and whenever polling stops — no leaked intervals.
  useEffect(() => {
    if (!pollingActive) return;

    const interval = setInterval(async () => {
      try {
        // Get indexing status from API
        const response = await api.getIndexingStatus();
        const status = response.status;

        if (!status) {
          setStatusMessage('Error checking indexing status');
          setPollingActive(false);
          return;
        }

        if (status.error) {
          // Indexing failed — stop polling instead of polling forever
          setStatusMessage(`Indexing failed: ${status.error}`);
          await fetchDocuments();
          setPollingActive(false);
          return;
        }

        if (status.isIndexing) {
          setStatusMessage(`Indexing in progress: ${status.progress}%`);
        } else if (status.lastIndexed) {
          // Indexing is complete — refresh the list and stop polling now;
          // keep the completion message visible briefly via clearStatusSoon
          // (each poll would otherwise reschedule the clear forever).
          await fetchDocuments();
          setStatusMessage(`Indexing completed at ${new Date(status.lastIndexed).toLocaleTimeString()}`);
          setPollingActive(false);
          clearStatusSoon();
        } else {
          // Not indexing and nothing indexed — nothing left to poll for
          setPollingActive(false);
        }
      } catch (error) {
        console.error('Error polling status:', error);
        setStatusMessage('Error checking indexing status');
        setPollingActive(false);
      }
    }, 2000);

    // Clean up interval on unmount or when polling stops
    return () => clearInterval(interval);
  }, [pollingActive, fetchDocuments]);

  // Clear the deferred status-cleanup timeout on unmount.
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
    };
  }, []);

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
    return <div className="document-manager"><p className="dm-hint">Loading documents...</p></div>;
  }

  return (
    <div className="document-manager">
      <h3>Document Management</h3>

      {message && <p className="dm-message">{message}</p>}
      {statusMessage && <p className="dm-status">{statusMessage}</p>}

      <div className="document-sections">
        <div className="document-section">
          <h4>Uploaded Documents (Not Indexed)</h4>
          {documents.filter(doc => !doc.indexed).length === 0 ? (
            <p className="dm-hint">No unindexed documents available.</p>
          ) : (
            <ul className="documents-list">
              {documents
                .filter(doc => !doc.indexed)
                .map((doc) => (
                  <li key={doc.filename} className="document-item">
                    <span className="document-name">
                      <span className="doc-icon" aria-hidden="true">📄</span>
                      {doc.originalName || doc.filename}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleIndexDocument(doc.filename)}
                      disabled={pollingActive || indexingStatus[doc.filename] === 'indexing'}
                      className="kb-button index-button"
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
          <h4>Indexed Documents</h4>
          {documents.filter(doc => doc.indexed).length === 0 ? (
            <p className="dm-hint">No indexed documents available.</p>
          ) : (
            <ul className="documents-list">
              {documents
                .filter(doc => doc.indexed)
                .map((doc) => (
                  <li key={doc.filename} className="document-item indexed">
                    <span className="document-name">
                      <span className="doc-icon" aria-hidden="true">📄</span>
                      {doc.originalName || doc.filename}
                    </span>
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
