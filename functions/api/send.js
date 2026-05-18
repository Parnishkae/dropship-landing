export async function onRequestPost(context) {

  const { request, env } = context;

  try {

    const data = await request.json();

    const message =
`🔥 Новая заявка!

Имя: ${data.name}
Телефон: ${data.phone}
Товар: ${data.product}`;

    const telegramUrl =
`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;

    const telegramResponse = await fetch(telegramUrl, {

      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        chat_id: env.CHAT_ID,
        text: message
      })

    });

    if (!telegramResponse.ok) {

      return new Response('Telegram error', {
        status: 500
      });

    }

    return new Response('OK');

  } catch (error) {

    return new Response('Server error', {
      status: 500
    });

  }

}