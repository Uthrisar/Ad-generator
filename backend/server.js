const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const os = require('os');
const axios = require('axios');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { chromium } = require('playwright');
const app = express();
const PORT = 4004;

const { GEMINI_API_KEY, GEMINI_API_URL } = process.env;

app.use(cors());
app.use(express.json());

// Use current directory instead of separate folders
const CURRENT_DIR = __dirname;

// Generate ad copy with Gemini
async function generateAdCopy(productData) {
  try {
    const { title, description, features, price } = productData;

    const prompt = `As a professional marketing copywriter, create compelling ad content for this product:
    Product: ${title}
    Price: ${price || 'Not specified'}
    Key Features:
    ${features?.join('\n') || 'N/A'}

    Description: ${description}

    Please generate a 15-second video script with EXACTLY this format:

    **Scene 1: 0-3 seconds**:
    **Voiceover**: [Opening hook about main benefit]

    **Scene 2: 3-6 seconds**:
    **Voiceover**: [Highlight key feature 1]

    **Scene 3: 6-9 seconds**:
    **Voiceover**: [Highlight key feature 2]

    **Scene 4: 9-12 seconds**:
    **Voiceover**: [Social proof or unique selling point]

    **Scene 5: 12-15 seconds**:
    **Voiceover**: [Strong CTA with urgency]

    Also provide:
    1. A 30-word social media ad (focus on top 3 benefits)
    2. A 100-word product highlight (for email marketing)

    Use emotional triggers and strong CTAs. Target audience: online shoppers aged 18-45.`;

    const response = await axios.post(
      GEMINI_API_URL,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      },
      {
        headers: { "Content-Type": "application/json" },
        params: { key: GEMINI_API_KEY },
      }
    );

    const candidate = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) {
      throw new Error('No text found in Gemini response');
    }
    return candidate;

  } catch (err) {
    const apiErr = err.response?.data || err.message;
    throw new Error(`Gemini API error: ${JSON.stringify(apiErr, null, 2)}`);
  }
}

async function navigateWithRetries(page, url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      return true;
    } catch (err) {
      if (i === attempts - 1) throw err;
      console.log(`Retrying navigation (attempt ${i + 1})`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// Enhanced text overlay parsing with improved formatting
function parseTextOverlaysFromAdCopy(adCopy) {
  const patterns = [
    /\*\*Scene (\d+): (\d+)-(\d+) seconds\*\*[\s\S]*?\*\*Voiceover:\*\*\s*([^\n]+)/gi,
    /(?:Scene|Part) (\d+)[\s\S]*?(\d+)-(\d+) seconds[\s\S]*?(?:Voiceover|Text):\s*([^\n]+)/gi,
    /(\d+)-(\d+) seconds[\s\S]*?:\s*([^\n]+)/gi
  ];

  const overlays = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(adCopy)) !== null) {
      const start = parseInt(match[match.length - 3] || match[match.length - 2]);
      const end = parseInt(match[match.length - 2] || start + 2);
      const text = match[match.length - 1].trim()
        .replace(/\*\*/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/₹/g, 'Rs.');

      if (text && !isNaN(start) && !isNaN(end)) {
        overlays.push({
          text,
          start,
          end,
          fadeIn: 0.5,
          fadeOut: 0.5
        });
      }
    }

    if (overlays.length > 0) break;
  }

  // Fallback: If no timing info found, create default overlays
  if (overlays.length === 0) {
    const sentences = adCopy.split('\n')
      .filter(line => line.trim().length > 10)
      .map(line => line.replace(/\*\*/g, '').trim())
      .slice(0, 5); // Limit to 5 sentences for 15-second video

    const durationPerSlide = 3;
    sentences.forEach((sentence, index) => {
      overlays.push({
        text: sentence,
        start: index * durationPerSlide,
        end: (index + 1) * durationPerSlide,
        fadeIn: 0.5,
        fadeOut: 0.5
      });
    });
  }
  return overlays.slice(0, 5); // Ensure exactly 5 overlays for 15-second video
}

async function downloadImage(url) {
  const imagePath = path.join(CURRENT_DIR, `temp-${uuidv4()}.jpg`);
  const file = fs.createWriteStream(imagePath);

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(imagePath);
      });
    }).on('error', (err) => {
      fs.unlink(imagePath, () => {});
      reject(err);
    });
  });
}

// Function to escape text for FFmpeg (from first file)
function escapeText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function buildFilterChain(textOverlays) {
  const width = 720;
  const height = 1280;

  let filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`
  ];

  // Get bold font for better readability
  const fontPath = process.platform === 'win32'
    ? 'C\\:/Windows/Fonts/arialbd.ttf'
    : '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';

  textOverlays.forEach((overlay, index) => {
    // 1. FORCE TEXT TO WRAP INTO 2-3 LINES
    const maxCharsPerLine = 30;
    const words = overlay.text.split(' ');
    let wrappedLines = [];
    let currentLine = '';

    words.forEach(word => {
      if ((currentLine + word).length <= maxCharsPerLine) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        wrappedLines.push(currentLine);
        currentLine = word;
      }
    });
    if (currentLine) wrappedLines.push(currentLine);

    const wrappedText = wrappedLines.join('\\n');

    // 2. CALCULATE SAFE POSITION
    const verticalBase = 0.3 + (index * 0.2);
    const yPosition = `(h*${Math.min(verticalBase, 0.7)})`;

    // 3. FADE TIMINGS
    const fadeInStart = overlay.start;
    const fadeInEnd = overlay.start + (overlay.fadeIn || 0.5);
    const fadeOutStart = overlay.end - (overlay.fadeOut || 0.5);
    const fadeOutEnd = overlay.end;

    // 4. ALPHA EXPRESSION FOR SMOOTH FADES
    const alphaExpression = `if(lt(t,${fadeInStart}),0,` +
                          `if(lt(t,${fadeInEnd}),(t-${fadeInStart})/${fadeInEnd-fadeInStart},` +
                          `if(lt(t,${fadeOutStart}),1,` +
                          `if(lt(t,${fadeOutEnd}),1-(t-${fadeOutStart})/${fadeOutEnd-fadeOutStart},` +
                          '0))))';

    // 5. BUILD TEXT FILTER
    filters.push(
      `drawtext=fontfile='${fontPath}':` +
      `text='${escapeText(wrappedText)}':` +
      `fontsize=36:` +
      `fontcolor=white:` +
      `x=(w-text_w)/2:` +
      `y=${yPosition}:'` +
      `box=1:` +
      `boxcolor=black@0.7:` +
      `boxborderw=15:` +
      `borderw=1:` +
      `bordercolor=white@0.3:` +
      `line_spacing=20:` +
      `text_align=center:'` +
      `alpha='${alphaExpression}':` +
      `enable='between(t,${overlay.start},${overlay.end})'`
    );
  });

  return filters.join(',');
}

// Enhanced video generation with improved logic from first file
async function generateVideoFromImage(productData) {
  try {
    console.log('⏳ Starting video generation with improved text visibility...');

    // 1. Download image to current directory
    const localImagePath = await downloadImage(productData.images[0]);
    const outputFilename = `video-${Date.now()}.mp4`;
    const outputPath = path.join(CURRENT_DIR, outputFilename);

    // 2. Create output directory if it doesn't exist
    if (!fs.existsSync(CURRENT_DIR)) {
      fs.mkdirSync(CURRENT_DIR, { recursive: true });
      console.log('📁 Created output directory:', CURRENT_DIR);
    }

    // 3. Remove existing output file if it exists
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
        console.log('🗑️ Removed existing output file');
      } catch (err) {
        console.error('❌ Could not remove existing file:', err.message);
      }
    }

    // 4. Get text overlays from ad copy
    const textOverlays = parseTextOverlaysFromAdCopy(productData.adCopy) || [];
    if (textOverlays.length === 0) {
      textOverlays.push({
        text: productData.title?.substring(0, 100) || 'New Product',
        start: 0,
        end: 15,
        fadeIn: 0.5,
        fadeOut: 0.5
      });
    }

    // 5. Create and run FFmpeg command using the improved logic
    return new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(localImagePath)
        .inputOptions([
          '-loop 1',
          '-t 15'
        ])
        .videoCodec('libx264')
        .outputOptions([
          '-vf', buildFilterChain(textOverlays),
          '-pix_fmt yuv420p',
          '-r 25',
          '-preset fast',
          '-crf 23',
          '-aspect 9:16'
        ])
        .output(outputPath);

      command
        // .on('start', (commandLine) => {
        //   console.log('🚀 FFmpeg command:', commandLine);
        // })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`📊 Progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Video created successfully at:', outputPath);
          console.log('📏 Video specs: 720x1280 (9:16), 15 seconds, 25fps');
          console.log('✨ Features: Improved text visibility with centered, larger text');

          // Clean up temp image
          fs.unlink(localImagePath, (err) => {
            if (err) console.error('Error deleting temp image:', err);
          });

          resolve({
            videoPath: `/videos/${outputFilename}`,
            localPath: outputPath,
            filename: outputFilename
          });
        })
        .on('error', (err, stdout, stderr) => {
          console.error('❌ FFmpeg error:', err.message);
          console.error('📝 FFmpeg stderr:', stderr);
          cleanupFiles([localImagePath, outputPath]);
          reject(new Error(`Video generation failed: ${err.message}`));
        });

      command.run();
    });

  } catch (err) {
    console.error('Generation Error:', err);
    throw new Error(`Video processing failed: ${err.message}`);
  }
}

function cleanupFiles(files) {
  files.forEach(file => {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.error(`Error deleting ${file}:`, err);
      }
    }
  });
}

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const { url, generateAd } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2}', route => route.abort());
    await page.route('**/*.css', route => route.abort());

    try {
      await navigateWithRetries(page, url);

      let productData;
      if (url.includes('amazon.')) {
        productData = await scrapeAmazon(page);
      } else if (await isShopifyStore(page)) {
        productData = await scrapeShopify(page);
      } else {
        return res.status(400).json({ error: 'Unsupported website' });
      }

      // Add AI-generated ad copy and video if requested
      if (generateAd) {
        try {
          productData.adCopy = await generateAdCopy(productData);
          const videoResult = await generateVideoFromImage(productData);
          productData.videoPath = videoResult.videoPath;
          productData.videoFilename = videoResult.filename;
        } catch (err) {
          console.error('Generation error:', err);
          // Continue even if video generation fails
          productData.generationError = err.message;
        }
      }
      return res.json(productData);

    } catch (navError) {
      console.error('Navigation error:', navError);
      return res.status(500).json({
        error: 'Page loading failed',
        details: navError.message
      });
    }
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({
      error: 'Failed to scrape product data',
      details: error.message
    });
  } finally {
    if (browser) await browser.close();
  }
});

// Serve videos from current directory
app.use('/videos', express.static(CURRENT_DIR, {
  setHeaders: (res, path) => {
    if (path.endsWith('.mp4')) {
      res.set('Cache-Control', 'public, max-age=31536000');
      res.set('Content-Type', 'video/mp4');
    }
  }
}));

// Amazon-specific scraper
async function scrapeAmazon(page) {
  try {
    // Wait for critical elements
    await page.waitForSelector('#productTitle, #landingImage, [data-component-type="product-image"]', {
      timeout: 15000
    });

    return await page.evaluate(() => {
      // Get title with fallbacks
      const title = document.querySelector('#productTitle')?.innerText?.trim() ||
                    document.querySelector('#title')?.innerText?.trim() ||
                    document.querySelector('h1')?.innerText?.trim();

      // Get price with multiple fallbacks
      const price = document.querySelector('.a-price .a-offscreen')?.innerText?.trim() ||
                    document.querySelector('.priceToPay span')?.innerText?.trim() ||
                    document.querySelector('.a-price-whole')?.innerText?.trim();

      // Get all images with multiple selectors
      const imageElements = [
        ...document.querySelectorAll('#imgTagWrapperId img, #landingImage, [data-a-image-name="landingImage"], .imgTagWrapper img')
      ];

      const images = [];
      imageElements.forEach(img => {
        const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-old-hires') || img.getAttribute('data-a-dynamic-image');
        if (src && !src.startsWith('data:')) {
          // Clean Amazon image URLs to get higher quality versions
          const cleanSrc = typeof src === 'string' ?
            src.replace(/\._.*?_\./, '._AC_SL1500_.') :
            src;
          images.push(cleanSrc);
        }
      });

      // Get description with fallbacks
      const description = document.querySelector('#productDescription')?.innerText?.trim() ||
                         document.querySelector('#feature-bullets')?.innerText?.trim() ||
                         document.querySelector('#productOverview')?.innerText?.trim() ||
                         document.querySelector('#description')?.innerText?.trim();

      // Get features/bullet points
      const features = Array.from(document.querySelectorAll('#feature-bullets li, .a-unordered-list li'))
        .map(el => el.innerText?.trim())
        .filter(text => text && !text.includes('class="a-icon a-icon-checkbox"'))
        .slice(0, 10); // Limit to top 10 features

      return {
        title,
        price,
        images: [...new Set(images.filter(Boolean))],
        description,
        features: features.length > 0 ? features : null
      };
    });
  } catch (e) {
    console.error('Scrape error:', e);
    throw new Error('Failed to extract product data from page');
  }
}

// Shopify detection
async function isShopifyStore(page) {
  return await page.evaluate(() => {
    return !!document.querySelector('meta[name="generator"][content*="Shopify"]') ||
           !!document.querySelector('link[href*="shopify"]');
  });
}

// Shopify scraper
async function scrapeShopify(page) {
  return await page.evaluate(() => {
    const title = document.querySelector('.product__title')?.innerText?.trim() ||
                  document.querySelector('.product-title')?.innerText?.trim();

    const price = document.querySelector('.price__regular .price-item--regular')?.innerText?.trim() ||
                  document.querySelector('.product-price')?.innerText?.trim();

    const images = Array.from(document.querySelectorAll('.product__media img, .product-single__media img'))
      .map(img => img.src || img.getAttribute('data-src'))
      .filter(src => src && !src.startsWith('data:'))
      .map(src => src.split('?')[0]);

    const description = document.querySelector('.product__description')?.innerText?.trim() ||
                       document.querySelector('.product-single__description')?.innerText?.trim();

    const features = Array.from(document.querySelectorAll('.product__accordion .accordion__content li, .product-tabs__content li'))
      .map(el => el.innerText?.trim())
      .filter(Boolean);

    return {
      title,
      price,
      images: [...new Set(images)],
      description,
      features: features.length > 0 ? features : null
    };
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});