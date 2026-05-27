import { test, expect } from "@playwright/test";

test("Teste Autogerado", async ({ page }) => {
  // Configura um viewport padrão de desktop para garantir visibilidade dos elementos
  await page.setViewportSize({ width: 1280, height: 800 });

  // Navegou para a URL: http://98.80.169.206:3000
  await page.goto("http://98.80.169.206:3000");

  // Clicou em: "Produto" (a)
  await page.click('a[title="Produtos"] >> visible=true');

  // Clicou em: path
  // O seletor foi corrigido para escapar os caracteres de dois pontos (:) em nomes de classes TailwindCSS como md:px-6 e md:py-6,
  // transformando-os em md\:px-6 e md\:py-6, pois o Playwright espera que dois pontos em classes sejam escapados.
  await page.click(
    "html:nth-of-type(1) > body:nth-of-type(1) > div.flex.flex-col.min-h-screen.bg-background:nth-of-type(2) > div.flex.flex-1.relative:nth-of-type(1) > div.flex-1.flex.flex-col.min-w-0.pb-14.md\:pb-0:nth-of-type(2) > div.flex.flex-col.flex-1.min-w-0:nth-of-type(1) > div.flex.flex-1.min-w-0:nth-of-type(1) > main.px-4.py-4.md\:px-6.md\:py-6.flex-1.overflow-auto.min-w-0:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div.rounded-lg.border.bg-card.text-card-foreground.shadow-sm:nth-of-type(1) > div.p-6:nth-of-type(2) > ul:nth-of-type(1) > li:nth-of-type(2) > div:nth-of-type(2) > a.inline-flex.items-center.justify-center.rounded-md.transition-colors.cursor-pointer.border-none.w-8.h-8.bg-transparent.text-muted-foreground:nth-of-type(1) > svg.lucide.lucide-pencil:nth-of-type(1) > path:nth-of-type(1) >> visible=true",
  );

  // Navegou para a URL: http://98.80.169.206:3000/plugins/menu-catalog-ui/products/e6896ebe-78f8-4055-af2f-74c407556961
  await page.goto(
    "http://98.80.169.206:3000/plugins/menu-catalog-ui/products/e6896ebe-78f8-4055-af2f-74c407556961",
  );

  // Clicou no botão "Salvar"
  await page.click('button:has-text("Salvar") >> visible=true');

  // Navegou para a URL: http://98.80.169.206:3000/plugins/menu-catalog-ui/products
  await page.goto("http://98.80.169.206:3000/plugins/menu-catalog-ui/products");
});
