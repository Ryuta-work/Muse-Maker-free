// /netlify/functions/generateImage.js

export default async (req, context) => {
  // 環境変数からAPIキーを安全に取得
  const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;
  const IMAGE_GENERATION_API_URL = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0';

  try {
    // フロントエンドから送られてきたプロンプトを取得
    const { prompt } = await req.json();

    // Hugging Face APIにリクエストを送信
    const apiResponse = await fetch(IMAGE_GENERATION_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUGGING_FACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: prompt }),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      // エラー情報をフロントエンドに返す
      return new Response(JSON.stringify({ error: `APIエラー: ${errorBody}` }), {
        status: apiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 成功した場合は画像データをそのままフロントエンドに返す
    const imageBlob = await apiResponse.blob();
    return new Response(imageBlob, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    });

  } catch (error) {
    // その他のエラー処理
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};