import { prisma } from "@/lib/prisma";

async function main() {
  const [categories, articles] = await Promise.all([
    prisma.category.findMany(),
    prisma.article.findMany({ select: { id: true, slug: true, status: true } }),
  ]);

  console.log("categories:", categories);
  console.log("articles:", articles);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
