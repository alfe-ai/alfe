# Dynamic Favicon Summary

Below is a concise overview of how to implement a simple dynamic (animated) favicon mechanism adopted here:

---

1. **Add the favicon link to the HTML**
   
   In your HTML, include a linking element with an `id` property (e.g., "favicon"). Assign a default favicon image or data URI:

   ```html
   <head>
     <!-- Default static (upright triangle) favicon -->
     <link
       id="favicon"
       rel="icon"
       type="image/svg+xml"
       href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><polygon points='32,4 4,60 60,60' fill='black' /></svg>"
     />
   </head>
   ```

2. **Prepare the rotating/animated icon**

   Define a second SVG with embedded animation. For example, a polygon plus an animateTransform tag:

   ```js
   const defaultFavicon = "data:image/svg+xml;utf8,<svg ...> ... </svg>";
   const rotatingFavicon = "data:image/svg+xml;utf8," +
     "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
       "<polygon points='10,4 58,32 10,60' fill='black' />" +
       "<path d='M32,4 A28,28 0 0 1 32,60' stroke='black' stroke-width='4' fill='none'>" +
         "<animateTransform " +
           "attributeName='transform' " +
           "type='rotate' " +
           "from='0 32 32' " +
           "to='360 32 32' " +
           "dur='1s' " +
           "repeatCount='indefinite' />" +
       "</path>" +
     "</svg>";
   ```

3. **Set up JavaScript to switch icons**

   Whenever a given event occurs (e.g., form submission), set the favicon to the animated version. Then restore it later:

   ```html
   <script>
     // Grab link element by ID
     const fav = document.getElementById("favicon");
     if (fav) {
       // On page load, use default
       window.addEventListener("load", () => {
         fav.href = defaultFavicon;
       });

       // On an action (e.g., form submit), switch to rotating icon
       const form = document.getElementById("exampleForm");
       if (form) {
         form.addEventListener("submit", () => {
           fav.href = rotatingFavicon;
         });
       }
     }
   </script>
   ```

That’s it. In other situations (submitting background tasks, etc.), toggle the favicon data URI to the animated one while it’s “busy,” and reset it afterward.

