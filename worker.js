export default {

  async fetch(request, env) {

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }

    try {

      const data = await request.json();

      const message = `
Новая заявка!

Имя: ${data.name}
Телефон: ${data.phone}
Товар: ${data.product}
      `;

      const telegramUrl =
        `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;

      const response = await fetch("/api/send", {

  method: "POST",

  headers: {
    "Content-Type": "application/json"
  },

  body: JSON.stringify({
    name,
    phone,
    product: product.title
  })

});

      if (!telegramResponse.ok) {

        return new Response("Telegram error", {
          status: 500
        });

      }

      return new Response("OK");

    } catch (error) {

      return new Response("Server error", {
        status: 500
      });

    }

  }

};