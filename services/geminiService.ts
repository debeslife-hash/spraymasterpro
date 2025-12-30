
import { GoogleGenAI, Type } from "@google/genai";

// Fix: obtain API key directly from process.env.API_KEY within the function scope.
export const analyzeArtworkColors = async (base64Image: string) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image.split(',')[1],
          },
        },
        {
          text: `Perform a master-level color analysis for a professional muralist using 2025 brand palettes. 
          Analyze the artwork and identify EVERY necessary shade to reproduce the image, including gradients and transitional mid-tones.
          
          Requirements:
          1. Detect at least 20-30 distinct color values if the image is complex.
          2. Focus on "color steps" - don't just pick the main color, pick the highlights, mid-tones, and shadow variations that create the gradient.
          3. Calculate the percentage of surface area for each detected shade precisely.
          4. Even minor detail colors (eyes, highlights, fine lines) must be included if they are visually distinct.
          5. Ensure the total area percentages sum to exactly 100%.
          
          Return the data strictly as a JSON array of objects: [{"colorName": string, "hex": string, "percentage": number}].`
        }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            colorName: { type: Type.STRING },
            hex: { type: Type.STRING },
            percentage: { type: Type.NUMBER },
          },
          required: ["colorName", "hex", "percentage"]
        }
      }
    }
  });

  // Fix: use response.text property directly (not a method call).
  return JSON.parse(response.text);
};

export const findNearestColor = (targetHex: string, palette: any[]) => {
  const hexToRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  };

  const colorDistance = (c1: any, c2: any) => {
    // DeltaE approximation for better perceptual matching
    return Math.sqrt(
      Math.pow(c1.r - c2.r, 2) * 0.3 + 
      Math.pow(c1.g - c2.g, 2) * 0.59 + 
      Math.pow(c1.b - c2.b, 2) * 0.11
    );
  };

  const targetRgb = hexToRgb(targetHex);
  let minDistance = Infinity;
  let nearest = palette[0];

  for (const color of palette) {
    const dist = colorDistance(targetRgb, hexToRgb(color.hex));
    if (dist < minDistance) {
      minDistance = dist;
      nearest = color;
    }
  }

  return nearest;
};
