import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { verifyToken } from '../middleware/auth.middleware.js';

const router = Router();

const uploadSchema = z
  .object({
    image: z.string().min(1, 'Image data is required'),
    name: z.string().optional(),
  })
  .strict();

/**
 * POST /api/upload/image
 * Server-side secure ImgBB upload keeping API key secret.
 */
router.post(
  '/upload/image',
  verifyToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = uploadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid upload payload.',
          details: parsed.error.format(),
          statusCode: 400,
        });
        return;
      }

      const rawImage = parsed.data.image.trim();
      let imageData = rawImage;
      if (imageData.includes('base64,')) {
        imageData = imageData.split('base64,')[1];
      }

      const apiKey = env.IMGBB_API_KEY;
      let finalUrl = '';

      if (rawImage.startsWith('http://') || rawImage.startsWith('https://')) {
        finalUrl = rawImage;
      } else if (apiKey && apiKey !== 'placeholder_imgbb_api_key') {
        try {
          const formData = new URLSearchParams();
          formData.append('image', imageData);
          if (parsed.data.name) {
            formData.append('name', parsed.data.name);
          }

          const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
          });

          const json = (await imgbbRes.json()) as any;
          if (imgbbRes.ok && json?.data?.url) {
            finalUrl = json.data.url;
          } else {
            console.warn('[Upload] ImgBB error, falling back to data URL:', json?.error?.message);
            finalUrl = `data:image/jpeg;base64,${imageData}`;
          }
        } catch (fetchErr) {
          console.warn('[Upload] ImgBB network issue, falling back to data URL:', fetchErr);
          finalUrl = `data:image/jpeg;base64,${imageData}`;
        }
      } else {
        // Safe fallback: preserve user's real uploaded photo as a high-fidelity data URI
        finalUrl = `data:image/jpeg;base64,${imageData}`;
      }

      res.status(200).json({
        success: true,
        url: finalUrl,
        display_url: finalUrl,
        data: {
          url: finalUrl,
          display_url: finalUrl,
        },
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
