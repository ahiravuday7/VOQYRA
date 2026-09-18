export const findOrCreateSeedDocument = async (Model, slug, buildData) => {
  // Include inactive and soft-deleted records.
  const existing = await Model.findOne({ slug });

  if (existing) {
    return existing;
  }

  // Build defaults only when creation is necessary.
  const document = new Model({
    ...buildData(),
    slug,
  });

  try {
    // Preserve document validation and validation hooks.
    return await document.save();
  } catch (error) {
    if (error?.code === 11000) {
      const concurrent = await Model.findOne({ slug });

      if (concurrent) {
        return concurrent;
      }
    }

    throw error;
  }
};
