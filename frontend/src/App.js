import React, { useState, useRef } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [productData, setProductData] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [selectedImage, setSelectedImage] = useState('');
  const videoRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url) {
      setError('Please enter a product URL');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setProductData(null);
      setVideoUrl('');
      setSelectedImage('');

      const response = await axios.post('http://localhost:4004/scrape', {
        url,
        generateAd: true
      });

      setProductData(response.data);
      if (response.data.images?.length > 0) {
        setSelectedImage(response.data.images[0]);
      }

      // Use the video path from the initial response
      if (response.data.videoPath) {
        setVideoUrl(`http://localhost:4004${response.data.videoPath}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to process the product');
      console.error('API error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (videoUrl && videoRef.current) {
      const link = document.createElement('a');
      link.href = videoUrl;
      link.download = `product-ad-${Date.now()}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleImageSelect = (imgUrl) => {
    setSelectedImage(imgUrl);
  };

  const handleRetryVideo = async () => {
    if (!productData) return;

    try {
      setLoading(true);
      setVideoUrl('');

      const response = await axios.post('http://localhost:4004/scrape', {
        url: window.location.href, // Or store original URL in state
        generateAd: true
      });

      if (response.data.videoPath) {
        setVideoUrl(`http://localhost:4004${response.data.videoPath}`);
      }
    } catch (err) {
      setError('Failed to regenerate video: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Product Video Generator</h1>
        <p>Create marketing videos from product pages</p>
      </header>

      <main className="main-content">
        <form onSubmit={handleSubmit} className="url-form">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter product URL (Amazon or Shopify)"
            className="url-input"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className={`submit-btn ${loading ? 'loading' : ''}`}
          >
            {loading ? (
              <>
                <span className="spinner"></span> Processing...
              </>
            ) : (
              'Generate Video'
            )}
          </button>
        </form>

        {error && (
          <div className="error-message">
            {error}
            {productData && !videoUrl && (
              <button onClick={handleRetryVideo} className="retry-btn">
                Retry Video Generation
              </button>
            )}
          </div>
        )}

        {productData && (
          <div className="results-container">
            <div className="product-info">
              <h2>{productData.title || 'No title available'}</h2>
              <p className="price">{productData.price || 'Price not available'}</p>

              {/* Product Image Gallery */}
              {productData.images?.length > 0 && (
                <div className="image-gallery">
                  <div className="main-image-container">
                    <img
                      src={selectedImage || productData.images[0]}
                      alt={productData.title || 'Product'}
                      className="main-image"
                    />
                  </div>
                  <div className="thumbnail-container">
                    {productData.images.slice(0, 5).map((img, index) => (
                      <img
                        key={index}
                        src={img}
                        alt={`Thumbnail ${index + 1}`}
                        className={`thumbnail ${selectedImage === img ? 'active' : ''}`}
                        onClick={() => handleImageSelect(img)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <p className="description">{productData.description || 'No description available'}</p>
            </div>

            {videoUrl ? (
              <div className="video-section">
                <h3>Generated Video</h3>
                <div className="video-container">
                  <video
                    controls
                    src={videoUrl}
                    className="video-preview"
                    ref={videoRef}
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
                <div className="video-actions">
                  <button onClick={handleDownload} className="download-btn">
                    Download Video
                  </button>
                  <button onClick={handleRetryVideo} className="secondary-btn">
                    Regenerate Video
                  </button>
                </div>
              </div>
            ) : (
              <div className="no-video">
                <p>No video was generated for this product</p>
                {productData.images?.length > 0 && (
                  <button onClick={handleRetryVideo} className="retry-btn">
                    Try Generating Video Again
                  </button>
                )}
              </div>
            )}

            {productData.adCopy && (
              <div className="ad-copy">
                <h3>Generated Ad Copy</h3>
                <div className="ad-content">
                  {productData.adCopy.split('\n\n').map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Product Video Generator &copy; {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}

export default App;