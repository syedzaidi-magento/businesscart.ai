import { useState, useEffect, useCallback, useRef } from 'react';
import { createProduct, getProducts, updateProduct, deleteProduct, getAccount, getUploadUrl, uploadFileToS3 } from '../api';
import { Product, Account, Attribute, PriceTier, Review, FAQItem, ProductAudience } from '../types';
import Navbar from './Navbar';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { PencilIcon, TrashIcon, PlusIcon, MagnifyingGlassIcon, PhotoIcon, XMarkIcon, StarIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import toast, { Toaster } from 'react-hot-toast';
import { PageHeader, CARD, TH, Spinner, BTN_PRIMARY } from './ui';

// Mirrors the caps enforced in catalog-service handler (maxFAQItems /
// maxFAQQuestion / maxFAQAnswer). Kept in step by hand: the server truncates
// silently, so a mismatch here shows the merchant text that will not be saved.
const MAX_FAQ_ITEMS = 10;
const MAX_FAQ_QUESTION = 200;
const MAX_FAQ_ANSWER = 2000;
import { useAuth } from '../hooks/useAuth';
import { canSeeCost } from '../orgRole';
import Pagination from './Pagination';

const CACHE_KEY = 'products_cache';

const ProductForm = () => {
  const { decodeJWT } = useAuth();
  // Staff (org_role "user") get cost redacted to 0 on read, so the field must not
  // be editable for them: saving would write that 0 back as the real cost. Kept
  // visible and disabled rather than removed from the DOM, per the platform rule
  // that role-gated controls explain themselves instead of vanishing.
  const showCost = canSeeCost(decodeJWT(localStorage.getItem('accessToken') || ''));
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const productsPerPage = 10;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    price: 0,
    dealPrice: undefined,
    description: '',
    sellerID: '',
    images: [],
    category: '',
    googleProductCategory: '',
    slug: '',
    sku: '',
    barcode: '',
    stock: 0,
    active: true,
    featured: false,
    attributes: [],
    priceTiers: [],
    groupIDs: [],
    audience: 'retail',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  // Row flash: briefly highlight the just-edited row so the eye lands on it
  // when the modal closes back to a paginated list.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1500);
    return () => clearTimeout(t);
  }, [flashId]);
  const [slugUnlocked, setSlugUnlocked] = useState(false);
  // Each pending file carries its own blob preview URL. Allocate the URL once
  // at add-time, revoke once at remove/clear-time. This avoids re-creating
  // URLs on every render (which caused flicker when adding a 2nd file).
  type PendingFile = { file: File; previewUrl: string };
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  // Drag enter/leave fire on every child crossing, so we track depth instead
  // of a boolean. isDragging only flips off when depth returns to zero.
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [markupPct, setMarkupPct] = useState('');

  // Revoke every pending blob URL and clear the list. Single helper used by
  // save-success, close-and-reset, open-modal, and handle-edit so every
  // clear path stays leak-free.
  const clearPendingFiles = useCallback(() => {
    setPendingFiles((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        try {
          const decodedUser = decodeJWT(token);
          if (decodedUser && decodedUser.id) {
            const fetchedAccount = await getAccount(decodedUser.id);
            setAccount(fetchedAccount);
            if (fetchedAccount.role === 'company') {
              setFormData((prev) => ({
                ...prev,
                accountID: fetchedAccount._id,
              }));
            }
          }
        } catch (e) {
          toast.error('Failed to fetch account data.');
        }
      } else {
        toast.error('Please log in to access products.');
      }
      await fetchProducts();
    };

    loadInitialData();
  }, [decodeJWT]);

  // Search changes jump back to page 1 (user expects to see top matches).
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Recompute filtered list when products refresh or search changes. Clamp
  // currentPage if the list shrunk (e.g. after a delete) so we never sit on
  // an empty page — but do NOT force page 1, so editing an item keeps the
  // user on the page they were viewing.
  useEffect(() => {
    const filtered = products.filter((product) =>
      product.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredProducts(filtered);
    const totalPagesNow = Math.max(1, Math.ceil(filtered.length / productsPerPage));
    setCurrentPage((p) => Math.min(p, totalPagesNow));
  }, [products, searchQuery, productsPerPage]);

  const fetchProducts = async () => {
    setIsLoading(true);
    try {
      const data = await getProducts();
      const sorted = [...data].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setProducts(sorted);
      setFilteredProducts(sorted);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error fetching products');
    } finally {
      setIsLoading(false);
    }
  };

  const invalidateCache = () => {
    localStorage.removeItem(CACHE_KEY);
  };

  const validateForm = () => {
    const newErrors: string[] = [];
    if (!formData.name) newErrors.push('Product name is required');
    if (formData.name && formData.name.includes('/')) newErrors.push('Product name cannot contain "/"');
    if (!formData.slug) newErrors.push('Slug is required');
    if (formData.slug && formData.slug.includes('/')) newErrors.push('Slug cannot contain "/"');
    if (formData.category && (formData.category.split('/').length > 2)) newErrors.push('Category supports max one "/" for primary / sub hierarchy');
    if (formData.price === undefined || formData.price <= 0) newErrors.push('Price must be positive');
    if (formData.dealPrice !== undefined && (formData.dealPrice < 0 || formData.dealPrice > 50)) {
      newErrors.push('Deal Price must be between 0 and 50');
    }
    if (formData.stock !== undefined && formData.stock < 0) newErrors.push('Stock cannot be negative');
    // Order rules: must be non-negative, and a max cannot sit below the min or the
    // case-pack increment (would make clampQty snap below the minimum orderable qty).
    const minQ = formData.minOrderQty || 0;
    const incQ = formData.orderIncrement || 0;
    const maxQ = formData.maxOrderQty || 0;
    if (minQ < 0 || incQ < 0 || maxQ < 0) newErrors.push('Order rules cannot be negative');
    if (maxQ > 0 && minQ > 0 && maxQ < minQ) newErrors.push('Max order qty cannot be less than min order qty');
    if (maxQ > 0 && incQ > 0 && maxQ < incQ) newErrors.push('Max order qty cannot be less than the case-pack increment');
    if (!formData.description) newErrors.push('Description is required');
    if (formData.priceTiers && formData.priceTiers.length > 0) {
      for (let i = 0; i < formData.priceTiers.length; i++) {
        const t = formData.priceTiers[i];
        if (i === 0 && (!t.minQty || t.minQty < 2)) { newErrors.push('First tier: Min qty must be >= 2 (base price covers qty 1)'); }
        else if (!t.minQty || t.minQty < 1) { newErrors.push(`Tier ${i + 1}: Min qty must be >= 1`); }
        if (!t.price || t.price <= 0) newErrors.push(`Tier ${i + 1}: Price must be > 0`);
        if (i > 0 && t.minQty <= formData.priceTiers[i - 1].minQty) newErrors.push(`Tier ${i + 1}: Min qty must be greater than previous tier`);
      }
    }
    return newErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = validateForm();
    setErrors(newErrors);
    if (newErrors.length > 0) return;

    setIsLoading(true);
    try {
      // Upload any pending files first, then combine with existing images
      let allImages = [...(formData.images || [])];
      if (pendingFiles.length > 0) {
        const newUrls = await uploadPendingFiles();
        allImages = [...allImages, ...newUrls];
      }
      const dataToSave: Record<string, unknown> = { ...formData, images: allImages };
      // Staff never receive the real cost (the list response redacts it to 0), so
      // sending the field back would overwrite the merchant's figure with that 0.
      // The server drops it too; both halves matter, because the server guard is
      // what protects the data and this one keeps the request honest about what
      // the user actually edited.
      if (!showCost) {
        delete dataToSave.cost;
      }

      const editedId = editingId;
      const wasEdit = !!editingId;
      if (editingId) {
        await updateProduct(editingId, dataToSave as unknown as Product);
        toast.success('Product updated successfully');
      } else {
        await createProduct(dataToSave as unknown as Omit<Product, '_id'>);
        toast.success('Product created successfully');
      }
      // Pending files are now uploaded — clear them in both flows so the
      // "Pending" badges disappear and the real S3 URLs render in their place.
      clearPendingFiles();

      if (wasEdit) {
        // Edit: keep the modal open with the refreshed image list so the
        // admin sees Pending → real-image transition without reopening.
        // Other fields stay as-is so they can continue editing.
        setFormData((prev) => ({ ...prev, images: allImages }));
      } else {
        // Create: reset the form and close — list view is the next destination.
        setFormData({
          name: '',
          price: 0,
          dealPrice: undefined,
          dealStartDate: undefined,
          dealEndDate: undefined,
          description: '',
          sellerID: account?._id || '',
          images: [],
          category: '',
          googleProductCategory: '',
          slug: '',
          sku: '',
          barcode: '',
          stock: 0,
          active: true,
          featured: false,
          attributes: [],
          priceTiers: [],
          groupIDs: [],
          audience: 'retail',
        });
        setEditingId(null);
        setSlugUnlocked(false);
        setIsModalOpen(false);
      }
      invalidateCache();
      await fetchProducts();
      if (editedId) setFlashId(editedId);
      setErrors([]);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save product');
    } finally {
      setIsLoading(false);
    }
  };

  const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    // Package fields default to 0 rather than undefined so CLEARING one actually
    // sends a value: JSON.stringify drops undefined keys, which would leave a
    // stale weight on the record with no way to remove it. The backend treats 0
    // as "unset this field".
    const parsed =
      ['price', 'dealPrice', 'cost'].includes(name) ? (parseFloat(value) || undefined)
      : ['weight', 'length', 'width', 'height'].includes(name) ? (parseFloat(value) || 0)
      : ['stock', 'minOrderQty', 'orderIncrement', 'maxOrderQty'].includes(name) ? (parseInt(value) || 0)
      : value;
    const updates: Partial<Product> = { [name]: parsed };
    // Auto-generate slug from name only when CREATING a new product.
    // Slugs are permanent URLs once a product exists: editing the title must
    // never silently change the slug because that breaks external links
    // (Google Shopping feed, search engines, customer bookmarks).
    // Within create mode: keep auto-syncing as long as the user hasn't
    // manually overridden the slug (i.e., it still matches the previous
    // auto-generated value from the prior name).
    if (name === 'name' && !editingId &&
        (!formData.slug || formData.slug === toSlug(formData.name || ''))) {
      updates.slug = toSlug(value);
    }
    setFormData({ ...formData, ...updates });
  };

  const handleAttributeChange = (index: number, field: keyof Attribute, value: string) => {
    const newAttributes = [...(formData.attributes || [])];
    newAttributes[index] = { ...newAttributes[index], [field]: value };
    setFormData({ ...formData, attributes: newAttributes });
  };

  const addAttribute = () => {
    setFormData({
      ...formData,
      attributes: [...(formData.attributes || []), { key: '', value: '', type: undefined }],
    });
  };

  const removeAttribute = (index: number) => {
    const newAttributes = [...(formData.attributes || [])];
    newAttributes.splice(index, 1);
    setFormData({ ...formData, attributes: newAttributes });
  };

  // Product Q&A. The server caps items at MAX_FAQ_ITEMS, trims, drops any pair
  // missing a half, and recomputes `count`, so this form only has to keep the
  // shape valid and stop the merchant typing past a limit that would be silently
  // enforced anyway.
  const faqItems = formData.faq?.items || [];

  const setFaqItems = (items: FAQItem[]) => {
    setFormData({ ...formData, faq: { ...(formData.faq || {}), items } });
  };

  const handleFaqChange = (index: number, field: 'question' | 'answer', value: string) => {
    const next = [...faqItems];
    next[index] = { ...next[index], [field]: value };
    setFaqItems(next);
  };

  const addFaqItem = () => {
    if (faqItems.length >= MAX_FAQ_ITEMS) return;
    setFaqItems([...faqItems, { question: '', answer: '' }]);
  };

  const removeFaqItem = (index: number) => {
    const next = [...faqItems];
    next.splice(index, 1);
    setFaqItems(next);
  };

  const addReview = () => {
    const newReview: Review = {
      name: '',
      rating: 5,
      title: '',
      body: '',
      verified: false,
      orderId: '',
      date: new Date().toISOString().slice(0, 10),
    };
    const existing = formData.rating?.reviews || [];
    setFormData({ ...formData, rating: { ...(formData.rating || {}), reviews: [...existing, newReview] } });
  };

  const updateReview = (index: number, field: keyof Review, value: string | number | boolean) => {
    const reviews = [...(formData.rating?.reviews || [])];
    reviews[index] = { ...reviews[index], [field]: value };
    setFormData({ ...formData, rating: { ...(formData.rating || {}), reviews } });
  };

  const removeReview = (index: number) => {
    const reviews = [...(formData.rating?.reviews || [])];
    reviews.splice(index, 1);
    setFormData({ ...formData, rating: { ...(formData.rating || {}), reviews } });
  };

  const handleTierChange = (index: number, field: keyof PriceTier, value: string) => {
    const tiers = [...(formData.priceTiers || [])];
    tiers[index] = { ...tiers[index], [field]: field === 'minQty' ? parseInt(value) || 0 : parseFloat(value) || 0 };
    setFormData({ ...formData, priceTiers: tiers });
  };

  const addTier = () => {
    const tiers = [...(formData.priceTiers || [])];
    const lastMinQty = tiers.length > 0 ? tiers[tiers.length - 1].minQty : 0;
    tiers.push({ minQty: lastMinQty + 10, price: 0 });
    setFormData({ ...formData, priceTiers: tiers });
  };

  const removeTier = (index: number) => {
    const tiers = [...(formData.priceTiers || [])];
    tiers.splice(index, 1);
    setFormData({ ...formData, priceTiers: tiers });
  };

  const toggleGroup = (groupId: string) => {
    const current = formData.groupIDs || [];
    const next = current.includes(groupId)
      ? current.filter((id) => id !== groupId)
      : [...current, groupId];
    setFormData({ ...formData, groupIDs: next });
  };

  const handleEdit = (product: Product) => {
    setFormData({
      name: product.name,
      price: product.price,
      cost: product.cost,
      dealPrice: product.dealPrice,
      dealStartDate: product.dealStartDate,
      dealEndDate: product.dealEndDate,
      description: product.description,
      sellerID: product.sellerID,
      images: product.images || [],
      category: product.category,
      googleProductCategory: product.googleProductCategory || '',
      rating: product.rating,
      // Must be carried across. handleEdit is a field-by-field whitelist, not a
      // spread, so omitting faq loaded the editor with an empty Q&A list and the
      // first question added then REPLACED every existing one on save.
      faq: product.faq,
      slug: product.slug || '',
      sku: product.sku || '',
      barcode: product.barcode || '',
      stock: product.stock || 0,
      active: product.active !== false,
      featured: product.featured || false,
      attributes: product.attributes || [],
      priceTiers: product.priceTiers || [],
      groupIDs: product.groupIDs || [],
      audience: product.audience || 'retail',
      minOrderQty: product.minOrderQty,
      orderIncrement: product.orderIncrement,
      maxOrderQty: product.maxOrderQty,
      weight: product.weight,
      length: product.length,
      width: product.width,
      height: product.height,
      customLabel0: product.customLabel0,
      customLabel1: product.customLabel1,
      customLabel2: product.customLabel2,
      customLabel3: product.customLabel3,
      customLabel4: product.customLabel4,
    });
    setEditingId(product._id);
    setSlugUnlocked(false);
    clearPendingFiles();
    dragDepth.current = 0;
    setIsDragging(false);
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (!productToDelete) return;
    setIsLoading(true);
    try {
      await deleteProduct(productToDelete);
      toast.success('Product deleted successfully');
      invalidateCache();
      await fetchProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete product');
    } finally {
      setIsDeleteConfirmOpen(false);
      setProductToDelete(null);
      setIsLoading(false);
    }
  };

  const openDeleteConfirm = (id: string) => {
    setProductToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  // Shared add-files path used by both the <input type=file> change handler
  // and the drag-drop handler. Filters out non-image files (matters for drop
  // since the OS file picker already filters via the `accept` attribute).
  // Does not touch the S3 upload path — pending files still upload via
  // uploadPendingFiles on save.
  const addFiles = useCallback((files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      toast.error('Please add image files only (jpg, png, webp)');
      return;
    }
    const newPending = images.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingFiles((prev) => [...prev, ...newPending]);
    toast.success(
      images.length === 1
        ? 'Image added — will upload when you save'
        : `${images.length} images added — will upload when you save`
    );
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    addFiles(files);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    if (e.dataTransfer.types?.includes('Files')) setIsDragging(true);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Hint the OS to use the "copy" cursor instead of "no-drop".
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setIsDragging(false);
    if (isLoading) return; // ignore drops during save so files don't get wiped
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) addFiles(files);
  };

  // Prevent the browser from navigating away when a dropped file misses the
  // dropzone (default behavior: open the file in a new tab). Scoped to the
  // window so it covers the modal too.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const uploadPendingFiles = async (): Promise<string[]> => {
    const uploadedUrls: string[] = [];
    for (const { file } of pendingFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const { uploadUrl, imageUrl } = await getUploadUrl(file.type, ext, formData.slug);
      await uploadFileToS3(uploadUrl, file);
      uploadedUrls.push(imageUrl);
    }
    return uploadedUrls;
  };

  const removeImage = (index: number) => {
    setFormData(prev => ({
      ...prev,
      images: (prev.images || []).filter((_, i) => i !== index),
    }));
  };

  const setMainImage = (index: number) => {
    setFormData(prev => {
      const imgs = [...(prev.images || [])];
      const [moved] = imgs.splice(index, 1);
      imgs.unshift(moved);
      return { ...prev, images: imgs };
    });
  };

  // Reset transient modal state on close-without-save so abandoned pending
  // files don't leak into the next opened product, and drag depth doesn't
  // get stuck if the modal closed mid-drag (no dragLeave fires).
  const closeAndReset = useCallback(() => {
    // Guard: don't close while a save is in flight. The Cancel/X buttons are
    // also visually disabled, but Dialog's backdrop/Esc still routes here, so
    // gate at the single chokepoint.
    if (isLoading) return;
    clearPendingFiles();
    dragDepth.current = 0;
    setIsDragging(false);
    setErrors([]);
    setIsModalOpen(false);
  }, [clearPendingFiles, isLoading]);

  const openModal = () => {
    clearPendingFiles();
    dragDepth.current = 0;
    setIsDragging(false);
    setFormData({
      name: '',
      price: 0,
      dealPrice: undefined,
      dealStartDate: undefined,
      dealEndDate: undefined,
      description: '',
      sellerID: account?._id || '',
      images: [],
      category: '',
      googleProductCategory: '',
      slug: '',
      sku: '',
      barcode: '',
      stock: 0,
      active: true,
      featured: false,
      attributes: [],
      priceTiers: [],
      groupIDs: [],
    });
    setEditingId(null);
    setSlugUnlocked(false);
    setErrors([]);
    setIsModalOpen(true);
  };

  // Pagination
  const indexOfLastProduct = currentPage * productsPerPage;
  const indexOfFirstProduct = indexOfLastProduct - productsPerPage;
  const currentProducts = filteredProducts.slice(indexOfFirstProduct, indexOfLastProduct);
  const totalPages = Math.ceil(filteredProducts.length / productsPerPage);

  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Toaster position="top-right" />
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <PageHeader title="Products" subtitle="Your catalog — what shows on the storefront and in feeds.">
          <button onClick={openModal} className={`${BTN_PRIMARY} flex items-center gap-1`}>
            <PlusIcon className="h-4 w-4" /> Add product
          </button>
        </PageHeader>

        {/* Search */}
        <div className="mt-6 mb-4">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products by name…"
              className="w-full py-2 pl-10 pr-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          </div>
        </div>

        {/* Product Table */}
        <div className={`${CARD} overflow-hidden`}>
          {isLoading ? (
            <div className="p-8 flex justify-center"><Spinner /></div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No products found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[750px] w-full text-sm">
                <thead>
                  <tr>
                    <th className={`${TH} text-left w-16`}>Image</th>
                    <th className={`${TH} text-left`}>Name</th>
                    <th className={`${TH} text-left`}>Status</th>
                    <th className={`${TH} text-left`}>Availability</th>
                    <th className={`${TH} text-left`}>Price</th>
                    <th className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {currentProducts.map((product) => (
                    <tr
                      key={product._id}
                      className={`hover:bg-gray-50 transition-colors duration-1000 ${flashId === product._id ? 'bg-yellow-100' : ''}`}
                    >
                      <td className="px-4 py-2 whitespace-nowrap">
                        {product.images && product.images[0] ? (
                          <img
                            src={product.images[0]}
                            alt={product.name}
                            loading="lazy"
                            className="h-10 w-10 rounded object-cover border border-gray-200"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded bg-gray-100 border border-gray-200 flex items-center justify-center">
                            <PhotoIcon className="h-5 w-5 text-gray-400" />
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        <div>{product.name}</div>
                        {(product.category || (product.attributes && product.attributes.length > 0)) && (
                          <div className="mt-0.5 text-xs font-normal text-gray-500">
                            {product.category}
                            {product.category && product.attributes && product.attributes.length > 0 && ' · '}
                            {product.attributes && product.attributes.length > 0 && (
                              <span>{product.attributes.length} attribute{product.attributes.length === 1 ? '' : 's'}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">{product.active !== false ? <span className="text-green-700 font-medium">Active</span> : <span className="text-red-600 font-medium">Inactive</span>}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {product.stock === undefined || product.stock === null ? (
                          <span className="text-gray-400">—</span>
                        ) : product.stock === 0 ? (
                          <span className="text-red-600 font-medium">Out of stock</span>
                        ) : product.stock <= 5 ? (
                          <span className="text-amber-700 font-medium">{product.stock} left</span>
                        ) : (
                          <span className="text-gray-700">{product.stock} in stock</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {product.dealPrice && product.dealPrice > 0 ? (
                          product.dealEndDate && new Date(product.dealEndDate) < new Date() ? (
                            <div>
                              <span className="text-gray-700">${product.price.toFixed(2)}</span>
                              <div className="text-xs text-red-500">{product.dealPrice}% deal expired</div>
                            </div>
                          ) : (
                            <div>
                              <span className="font-semibold text-teal-700">${(product.price * (1 - product.dealPrice / 100)).toFixed(2)}</span>
                              <span className="ml-2 text-gray-400 line-through">${product.price.toFixed(2)}</span>
                              <div className="text-xs font-medium text-green-600">
                                {product.dealPrice}% off{product.dealEndDate ? ` · until ${new Date(product.dealEndDate).toLocaleDateString()}` : ''}
                              </div>
                            </div>
                          )
                        ) : (
                          <span className="text-gray-700">${product.price.toFixed(2)}</span>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleEdit(product)}
                          className="text-yellow-600 hover:bg-yellow-50 rounded p-2 mr-1"
                          aria-label={`Edit ${product.name}`}
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => openDeleteConfirm(product._id)}
                          className="text-red-600 hover:bg-red-50 rounded p-2"
                          aria-label={`Delete ${product.name}`}
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredProducts.length > 0 && (
          <div className="mt-4 text-sm text-gray-500">
            Showing {((currentPage - 1) * productsPerPage) + 1}-{Math.min(currentPage * productsPerPage, filteredProducts.length)} of {filteredProducts.length} products
          </div>
        )}
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={paginate} />

        {/* Product Form Modal */}
        <Transition appear show={isModalOpen} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={closeAndReset}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black bg-opacity-25" />
            </Transition.Child>

            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-2 sm:p-4 text-center">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-300"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-5xl transform overflow-hidden rounded-xl bg-white text-left align-middle shadow-2xl transition-all flex flex-col max-h-[95vh] sm:max-h-[90vh]">
                    <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
                      <Dialog.Title as="h3" className="text-base sm:text-lg font-semibold leading-6 text-gray-900">
                        {editingId ? 'Edit Product' : 'Add Product'}
                      </Dialog.Title>
                      <button
                        type="button"
                        onClick={closeAndReset}
                        disabled={isLoading}
                        className="text-gray-400 hover:text-gray-600 rounded p-1 disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Close"
                      >
                        <XMarkIcon className="h-5 w-5" />
                      </button>
                    </div>
                    <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-5 sm:space-y-6">
                    {errors.length > 0 && (
                      <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
                        {errors.map((error, idx) => (
                          <p key={idx}>{error}</p>
                        ))}
                      </div>
                    )}
                      {/* Section: Basic Info */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">Basic Info</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Product Name</label>
                            <input
                              name="name"
                              value={formData.name}
                              onChange={handleChange}
                              placeholder="Product Name"
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Category</label>
                            <input
                              list="category-suggestions"
                              name="category"
                              value={formData.category}
                              onChange={handleChange}
                              placeholder="e.g. Electronics / Phones"
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                            />
                            <datalist id="category-suggestions">
                              {Array.from(new Set(products.map(p => p.category).filter(Boolean))).map(cat => (
                                <option key={cat} value={cat} />
                              ))}
                            </datalist>
                            <p className="mt-1 text-xs text-gray-400">Use "Primary / Sub" for hierarchy (e.g. "Electronics / Phones"). Without "/" it's a standalone category.</p>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Google Product Category (for ad feeds)</label>
                            <input
                              name="googleProductCategory"
                              value={formData.googleProductCategory || ''}
                              onChange={handleChange}
                              placeholder="e.g. Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Oven Mitts & Potholders"
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                            />
                            <p className="mt-1 text-xs text-gray-400">Paste the full path or numeric ID from <a href="https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt" target="_blank" rel="noopener noreferrer" className="text-teal-600 underline">Google's product taxonomy</a>. Used in Google Shopping, Facebook, Pinterest, Bing, and TikTok feeds. Leave blank to skip.</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Slug</label>
                            <input
                              name="slug"
                              value={formData.slug}
                              onChange={handleChange}
                              placeholder="product-slug"
                              disabled={!!editingId && !slugUnlocked}
                              className={`mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500 ${!!editingId && !slugUnlocked ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                            />
                            {editingId && (
                              <label className="mt-2 flex items-start gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={slugUnlocked}
                                  onChange={(e) => setSlugUnlocked(e.target.checked)}
                                  className="mt-0.5 h-4 w-4 text-teal-700 focus:ring-teal-500 border-gray-300 rounded"
                                />
                                <span className="text-xs text-gray-600 leading-snug">
                                  <strong>Allow slug edit.</strong> Changing the slug breaks the product URL and existing Google Shopping feed entries. Only check if you intentionally want to change the URL.
                                </span>
                              </label>
                            )}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">SKU</label>
                            <input
                              name="sku"
                              value={formData.sku}
                              onChange={handleChange}
                              placeholder="e.g., GLV-BBQ-001"
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Barcode / UPC</label>
                            <input
                              name="barcode"
                              value={formData.barcode}
                              onChange={handleChange}
                              placeholder="e.g., 012345678901"
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Stock</label>
                            <input
                              name="stock"
                              type="number"
                              min="0"
                              value={formData.stock}
                              onChange={handleChange}
                              placeholder="0"
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section: Order rules (B2B per-product quantity rules) */}
                      <div className="pt-2 border-t border-gray-100">
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 mt-4">Order rules</h4>
                        <p className="text-xs text-gray-500 mb-2">Optional per-product quantity rules for B2B ordering. Leave blank for none.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Min order qty</label>
                            <input name="minOrderQty" type="number" min="0" value={formData.minOrderQty ?? ''} onChange={handleChange} placeholder="0" className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Case pack / increment</label>
                            <input name="orderIncrement" type="number" min="0" value={formData.orderIncrement ?? ''} onChange={handleChange} placeholder="1" className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Max order qty</label>
                            <input name="maxOrderQty" type="number" min="0" value={formData.maxOrderQty ?? ''} onChange={handleChange} placeholder="0" className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500" />
                          </div>
                        </div>
                      </div>

                      {/* Section: Shipping (package as shipped; fixed units lb / in) */}
                      <div className="pt-2 border-t border-gray-100">
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 mt-4">Shipping</h4>
                        <p className="text-xs text-gray-500 mb-2">Weight and size of the package as shipped, not the product on its own. Shown on the storefront and used for shipping rates. Leave blank if not applicable.</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Weight (lb)</label>
                            <input name="weight" type="number" min="0" step="0.01" value={formData.weight || ''} onChange={handleChange} placeholder="0" className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Length (in)</label>
                            <input name="length" type="number" min="0" step="0.01" value={formData.length || ''} onChange={handleChange} placeholder="0" className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Width (in)</label>
                            <input name="width" type="number" min="0" step="0.01" value={formData.width || ''} onChange={handleChange} placeholder="0" className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Height (in)</label>
                            <input name="height" type="number" min="0" step="0.01" value={formData.height || ''} onChange={handleChange} placeholder="0" className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500" />
                          </div>
                        </div>
                      </div>

                      {/* Section: Ad segmentation (custom_label_0-4, feed-only) */}
                      <div className="pt-2 border-t border-gray-100">
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 mt-4">Ad segmentation</h4>
                        <p className="text-xs text-gray-500 mb-2">
                          Optional labels sent to shopping feeds (Google, Bing, Meta, Pinterest, TikTok) to split ad campaigns.
                          Never shown to shoppers. Use them for groupings your categories cannot express, like margin tier or
                          seasonality. Max 100 characters each.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <div key={i}>
                              <label className="block text-sm font-medium text-gray-700">Custom label {i}</label>
                              <input
                                name={`customLabel${i}`}
                                type="text"
                                maxLength={100}
                                value={(formData[`customLabel${i}` as keyof Product] as string) || ''}
                                onChange={handleChange}
                                placeholder={i === 0 ? 'e.g. high-margin' : ''}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Section: Pricing */}
                      <div className="pt-2 border-t border-gray-100">
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 mt-4">Pricing</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Price</label>
                            <input
                              name="price"
                              type="number"
                              step="0.01"
                              value={formData.price}
                              onChange={handleChange}
                              placeholder="19.99"
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Deal Price (%)</label>
                            <input
                              name="dealPrice"
                              type="number"
                              step="1"
                              min="0"
                              max="50"
                              value={formData.dealPrice ?? ''}
                              onChange={handleChange}
                              placeholder="e.g., 10 (for 10% off)"
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Cost ($) <span className="text-xs text-gray-400">(private, never shown to buyers)</span></label>
                            {/* title sits on the WRAPPER, not the input: browsers suppress
                                mouse events on a disabled control, so a title there often
                                never renders a tooltip. Same wrapper pattern the sidebar
                                uses for its role-gated entries. */}
                            <div title={showCost ? undefined : 'Cost is visible to owners and admins. Your other edits save normally and the stored cost is left unchanged.'}>
                              <input
                                name="cost"
                                type="number"
                                step="0.01"
                                min="0"
                                value={showCost ? (formData.cost ?? '') : ''}
                                onChange={handleChange}
                                disabled={!showCost}
                                aria-disabled={!showCost}
                                placeholder={showCost ? 'e.g., 12.50' : 'Hidden'}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                              />
                            </div>
                          </div>
                          {(() => {
                            const c = formData.cost, p = formData.price;
                            if (c === undefined || c <= 0 || p === undefined || p <= 0) return null;
                            const m = p - c;
                            const dp = formData.dealPrice;
                            const hasDeal = dp !== undefined && dp > 0;
                            const dealSell = hasDeal ? p * (1 - dp / 100) : p;
                            const dm = dealSell - c;
                            return (
                              <div className="flex flex-col justify-end pb-1">
                                <span className="text-xs text-gray-400">Gross margin (base price)</span>
                                <span className="text-sm font-semibold text-gray-800">${m.toFixed(2)}<span className={`ml-1 ${m >= 0 ? 'text-green-600' : 'text-red-600'}`}>({((m / p) * 100).toFixed(1)}%)</span></span>
                                {hasDeal && (
                                  <span className="text-xs mt-1 text-gray-500">At deal price ${dealSell.toFixed(2)}: <span className={`font-semibold ${dm >= 0 ? 'text-green-600' : 'text-red-600'}`}>${dm.toFixed(2)} ({((dm / dealSell) * 100).toFixed(1)}%)</span></span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {(() => {
                          const c = formData.cost;
                          if (c === undefined || c <= 0) return null;
                          const pct = parseFloat(markupPct);
                          const valid = !isNaN(pct) && pct >= 0;
                          const suggested = valid ? c * (1 + pct / 100) : 0;
                          return (
                            <div className="mt-4 rounded-md bg-gray-50 border border-gray-200 p-3">
                              <div className="flex flex-wrap items-end gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-600">Cost-plus markup (%)</label>
                                  <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    value={markupPct}
                                    onChange={(e) => setMarkupPct(e.target.value)}
                                    placeholder="e.g., 40"
                                    className="mt-1 w-28 p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                                  />
                                </div>
                                {valid && (
                                  <div className="pb-1">
                                    <span className="text-xs text-gray-500">Suggested price</span>
                                    <div className="text-sm font-semibold text-gray-800">${suggested.toFixed(2)}</div>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  disabled={!valid}
                                  onClick={() => setFormData({ ...formData, price: parseFloat(suggested.toFixed(2)) })}
                                  className="pb-1 text-sm font-semibold text-teal-700 hover:text-teal-800 disabled:text-gray-300 disabled:cursor-not-allowed"
                                >
                                  Apply to price
                                </button>
                              </div>
                              <p className="mt-1 text-xs text-gray-400">Sets price to cost x (1 + markup). Helper only, nothing stored.</p>
                            </div>
                          );
                        })()}
                        {formData.dealPrice && formData.dealPrice > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Deal Start Date</label>
                              <input
                                name="dealStartDate"
                                type="datetime-local"
                                value={formData.dealStartDate ? new Date(formData.dealStartDate).toISOString().slice(0, 16) : ''}
                                onChange={(e) => setFormData({ ...formData, dealStartDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500 text-sm"
                              />
                              <p className="text-xs text-gray-500 mt-1">Optional. Leave empty for immediate start.</p>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Deal End Date</label>
                              <input
                                name="dealEndDate"
                                type="datetime-local"
                                value={formData.dealEndDate ? new Date(formData.dealEndDate).toISOString().slice(0, 16) : ''}
                                onChange={(e) => setFormData({ ...formData, dealEndDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500 text-sm"
                              />
                              <p className="text-xs text-gray-500 mt-1">Optional. Leave empty for no expiry.</p>
                            </div>
                          </div>
                        )}
                        {/* Price Tiers */}
                        <div className="mt-4">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Volume Pricing / Quantity Breaks</label>
                          <p className="text-xs text-gray-500 mb-2">Optional. Set lower prices for bulk orders. Base price applies below the first tier.</p>
                          {(formData.priceTiers || []).map((tier, i) => (
                            <div key={i} className="flex items-center gap-2 mb-2">
                              <input type="number" min="1" value={tier.minQty || ''} onChange={(e) => handleTierChange(i, 'minQty', e.target.value)} placeholder="Min qty" className="w-24 p-2 border border-gray-300 rounded-md text-sm" />
                              <span className="text-sm text-gray-500">+ units @</span>
                              <input type="number" min="0.01" step="0.01" value={tier.price || ''} onChange={(e) => handleTierChange(i, 'price', e.target.value)} placeholder="Price" className="w-28 p-2 border border-gray-300 rounded-md text-sm" />
                              <button type="button" onClick={() => removeTier(i)} className="text-red-500 hover:text-red-700 text-sm">Remove</button>
                            </div>
                          ))}
                          <button type="button" onClick={addTier} className="text-sm text-teal-700 hover:text-teal-900 font-medium">+ Add tier</button>
                        </div>
                      </div>

                      {/* Section: Visibility */}
                      <div className="pt-2 border-t border-gray-100">
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 mt-4">Visibility</h4>

                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Sell to</label>
                        <p className="text-xs text-gray-500 mb-2">
                          Controls how this product appears on your public storefront. It does not change who can buy it
                          in the portal: your B2B customers keep their negotiated pricing either way.
                        </p>
                        <select
                          name="audience"
                          value={formData.audience || 'retail'}
                          onChange={(e) => setFormData({ ...formData, audience: e.target.value as ProductAudience })}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-teal-500 focus:border-teal-500 sm:text-sm"
                        >
                          <option value="retail">Retail only: price and Add to Cart on the storefront</option>
                          <option value="both">Retail and wholesale: adds a trade-access link</option>
                          <option value="wholesale">Wholesale only: no price, no Add to Cart, trade enquiry instead</option>
                        </select>
                        {formData.audience === 'wholesale' && (
                          <p className="mt-2 text-xs text-amber-700">
                            Wholesale only: this product stays visible and searchable on your storefront, but shoppers
                            cannot see a price or buy it there, and it is removed from your shopping feeds and deals.
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">B2B Visibility Groups</label>
                        <p className="text-xs text-gray-500 mb-2">
                          Restrict this product to specific B2B customer groups. Leave all unchecked = visible to everyone (B2B + B2C). B2C storefront customers always see this product regardless of groups.
                        </p>
                        {(account?.company?.customerGroups || []).length === 0 ? (
                          <p className="text-xs text-gray-400 italic">No groups defined. Add groups in Company Settings → Customer Groups.</p>
                        ) : (
                          <div className="space-y-2">
                            {(account?.company?.customerGroups || []).map((g) => {
                              const checked = (formData.groupIDs || []).includes(g.id);
                              return (
                                <label key={g.id} className="flex items-center space-x-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleGroup(g.id)}
                                    className="h-4 w-4 text-teal-700 focus:ring-teal-500 border-gray-300 rounded"
                                  />
                                  <span className="text-sm text-gray-700">
                                    {g.name}
                                    {g.groupPriceDiscount ? <span className="text-xs text-gray-400 ml-2">{g.groupPriceDiscount}% off</span> : null}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                          <div className="flex items-center space-x-3">
                            <input
                              type="checkbox"
                              name="active"
                              checked={formData.active !== false}
                              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                              className="h-4 w-4 text-teal-700 focus:ring-teal-500 border-gray-300 rounded"
                            />
                            <label className="text-sm font-medium text-gray-700">Active (visible on storefront and catalog)</label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <input
                              type="checkbox"
                              name="featured"
                              checked={formData.featured || false}
                              onChange={(e) => setFormData({ ...formData, featured: e.target.checked })}
                              className="h-4 w-4 text-teal-700 focus:ring-teal-500 border-gray-300 rounded"
                            />
                            <label className="text-sm font-medium text-gray-700">Featured on storefront homepage</label>
                          </div>
                        </div>
                        {account?.role !== 'partner' && (
                          <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700">Account ID</label>
                            <input
                              name="accountID"
                              value={formData.sellerID}
                              onChange={handleChange}
                              placeholder="Account ID"
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600 focus:ring-teal-500 focus:border-teal-500"
                              readOnly
                            />
                          </div>
                        )}
                      </div>

                      {/* Section: Media */}
                      <div className="pt-2 border-t border-gray-100">
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 mt-4">Media</h4>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Images</label>
                        {((formData.images || []).length > 0 || pendingFiles.length > 0) && (
                          <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
                            {(formData.images || []).map((url, i) => (
                              <div key={`existing-${i}`} className={`relative rounded-lg overflow-hidden border-2 ${i === 0 ? 'border-teal-700' : 'border-gray-200'} transition-colors`}>
                                <div className="aspect-square cursor-pointer" onClick={() => setPreviewImage(url)}>
                                  <img src={url} alt={`Product ${i + 1}`} className="w-full h-full object-cover" />
                                </div>
                                {/* Delete: top-LEFT (red), always visible for mobile */}
                                <button
                                  type="button"
                                  onClick={() => removeImage(i)}
                                  className="absolute top-1 left-1 bg-white/95 text-red-600 rounded-full p-2 shadow-md hover:bg-red-50 active:scale-95 transition"
                                  title="Remove"
                                  aria-label={`Remove image ${i + 1}`}
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                                {/* Star (set main): top-RIGHT (teal), only for non-main */}
                                {i !== 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setMainImage(i)}
                                    className="absolute top-1 right-1 bg-white/95 text-teal-700 rounded-full p-2 shadow-md hover:bg-teal-50 active:scale-95 transition"
                                    title="Set as main"
                                    aria-label={`Set image ${i + 1} as main`}
                                  >
                                    <StarIcon className="h-4 w-4" />
                                  </button>
                                )}
                                {/* Main badge: bottom-LEFT so top-left stays free for delete */}
                                {i === 0 && (
                                  <span className="absolute bottom-1 left-1 flex items-center gap-0.5 bg-teal-700 text-white text-xs px-1.5 py-0.5 rounded">
                                    <StarIconSolid className="h-3 w-3" /> Main
                                  </span>
                                )}
                              </div>
                            ))}
                            {pendingFiles.map((pending, i) => (
                              <div key={`pending-${i}`} className="relative rounded-lg overflow-hidden border-2 border-dashed border-teal-500">
                                <div className="aspect-square">
                                  <img src={pending.previewUrl} alt={`New ${i + 1}`} className="w-full h-full object-cover" />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setPendingFiles((prev) => {
                                    URL.revokeObjectURL(prev[i].previewUrl);
                                    return prev.filter((_, idx) => idx !== i);
                                  })}
                                  className="absolute top-1 left-1 bg-white/95 text-red-600 rounded-full p-2 shadow-md hover:bg-red-50 active:scale-95 transition"
                                  title="Remove"
                                  aria-label={`Remove pending image ${i + 1}`}
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                                <span className="absolute bottom-1 left-1 bg-teal-700 text-white text-xs px-1.5 py-0.5 rounded">Pending</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/webp,image/jpeg,image/png"
                          multiple
                          onChange={handleImageUpload}
                          className="hidden"
                          disabled={isLoading}
                        />
                        <div
                          role="button"
                          tabIndex={isLoading ? -1 : 0}
                          aria-disabled={isLoading}
                          onClick={() => { if (!isLoading) fileInputRef.current?.click(); }}
                          onKeyDown={(e) => {
                            if (isLoading) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              fileInputRef.current?.click();
                            }
                          }}
                          onDragEnter={handleDragEnter}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          className={`mt-3 flex items-center justify-center w-full h-24 border-2 border-dashed rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                            isLoading
                              ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                              : isDragging
                              ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-300 cursor-pointer'
                              : 'border-gray-300 hover:border-teal-500 hover:bg-teal-50/50 cursor-pointer'
                          }`}
                        >
                          <div className="flex flex-col items-center text-sm text-gray-600 pointer-events-none">
                            <PhotoIcon className="h-6 w-6 mb-1" />
                            <span className="font-medium">
                              {isDragging ? 'Drop to add image' : 'Drag & drop or click to add image'}
                            </span>
                            <span className="text-xs text-gray-400 mt-0.5">JPG, PNG, or WEBP</span>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center space-x-2">
                          <input
                            type="text"
                            placeholder="Or paste image URLs (comma-separated)"
                            className="flex-1 p-2 border border-gray-300 rounded-md text-sm focus:ring-teal-500 focus:border-teal-500"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const input = e.currentTarget;
                                const urls = input.value.split(',').map(u => u.trim()).filter(Boolean);
                                if (urls.length > 0) {
                                  setFormData(prev => ({
                                    ...prev,
                                    images: [...(prev.images || []), ...urls],
                                  }));
                                  input.value = '';
                                }
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm hover:bg-gray-200"
                            onClick={(e) => {
                              const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                              const urls = input.value.split(',').map(u => u.trim()).filter(Boolean);
                              if (urls.length > 0) {
                                setFormData(prev => ({
                                  ...prev,
                                  images: [...(prev.images || []), ...urls],
                                }));
                                input.value = '';
                              }
                            }}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                      </div>

                      {/* Section: Details */}
                      <div className="pt-2 border-t border-gray-100">
                        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3 mt-4">Details</h4>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Description</label>
                          <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            placeholder="Product description"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                            rows={4}
                          />
                        </div>
                        <div className="mt-4">
                          <label className="block text-sm font-medium text-gray-700">Attributes</label>
                          {formData.attributes?.map((attr, index) => (
                            <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_140px_auto] gap-2 mt-2 items-start">
                              <input
                                type="text"
                                placeholder="Key"
                                value={attr.key}
                                onChange={(e) => handleAttributeChange(index, 'key', e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md text-sm"
                              />
                              <input
                                type="text"
                                placeholder="Value"
                                value={attr.value}
                                onChange={(e) => handleAttributeChange(index, 'value', e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md text-sm"
                              />
                              <select
                                value={attr.type}
                                onChange={(e) => handleAttributeChange(index, 'type', e.target.value as 'filterable' | 'system')}
                                className="w-full p-2 border border-gray-300 rounded-md text-sm"
                              >
                                <option value="">None</option>
                                <option value="filterable">Filterable</option>
                                <option value="system">System</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => removeAttribute(index)}
                                className="text-red-600 hover:bg-red-50 rounded p-2 justify-self-start sm:justify-self-center"
                                aria-label="Remove attribute"
                              >
                                <TrashIcon className="h-5 w-5" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addAttribute}
                            className="mt-2 text-sm text-teal-700 hover:text-teal-900 font-medium"
                          >
                            + Add Attribute
                          </button>
                        </div>

                        {/* Product Q&A. Merchant-authored, unlike reviews. */}
                        <div className="sm:col-span-2 border-t border-gray-200 pt-4 mt-2">
                          <div className="flex items-baseline justify-between mb-1">
                            <label className="block text-sm font-medium text-gray-700">Questions &amp; Answers</label>
                            <span className="text-xs text-gray-500">{faqItems.length} of {MAX_FAQ_ITEMS}</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-3">
                            Answer what buyers ask before they buy. These show on the product page and are
                            what AI assistants quote when someone asks about this product.
                          </p>

                          {faqItems.length === 0 && (
                            <p className="text-sm text-gray-500 italic mb-2">
                              No questions yet. Add the one buyers ask most.
                            </p>
                          )}

                          {faqItems.map((item, index) => (
                            <div key={index} className="grid grid-cols-[1fr_auto] gap-2 mt-2 items-start">
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  placeholder="Question, for example: What temperature are these rated to?"
                                  value={item.question}
                                  maxLength={MAX_FAQ_QUESTION}
                                  onChange={(e) => handleFaqChange(index, 'question', e.target.value)}
                                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                                />
                                <textarea
                                  placeholder="Answer in a sentence or two. Plain language, no marketing."
                                  value={item.answer}
                                  maxLength={MAX_FAQ_ANSWER}
                                  rows={2}
                                  onChange={(e) => handleFaqChange(index, 'answer', e.target.value)}
                                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => removeFaqItem(index)}
                                className="text-red-600 hover:bg-red-50 rounded p-2"
                                aria-label={`Remove question ${index + 1}`}
                              >
                                <TrashIcon className="h-5 w-5" />
                              </button>
                            </div>
                          ))}

                          <button
                            type="button"
                            onClick={addFaqItem}
                            disabled={faqItems.length >= MAX_FAQ_ITEMS}
                            className="mt-2 text-sm text-teal-700 hover:text-teal-900 font-medium disabled:text-gray-400 disabled:hover:text-gray-400"
                          >
                            + Add Question
                          </button>
                          {faqItems.length >= MAX_FAQ_ITEMS && (
                            <span className="ml-2 text-xs text-gray-500">
                              Limit reached. Remove one to add another.
                            </span>
                          )}
                        </div>

                        {/* Customer Reviews */}
                        <div className="sm:col-span-2 border-t border-gray-200 pt-4 mt-2">
                          <div className="flex items-baseline justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700">Customer Reviews</label>
                            {formData.rating?.count ? (
                              <span className="text-xs text-gray-500">
                                Avg <strong>{(formData.rating.average ?? 0).toFixed(1)}</strong> / 5 · {formData.rating.count} review{formData.rating.count !== 1 ? 's' : ''}
                                <em className="ml-2 text-gray-400">(auto-computed)</em>
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-gray-400 mb-3">
                            Reviews are added manually (no public submission). Send a review-request email from the order detail page; transcribe the customer's reply here.
                          </p>
                          <div className="space-y-3">
                            {(formData.rating?.reviews || []).map((r, i) => (
                              <div key={i} className="p-3 border border-gray-200 rounded-md bg-gray-50">
                                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                                  <input
                                    value={r.name}
                                    onChange={(e) => updateReview(i, 'name', e.target.value)}
                                    placeholder="Name"
                                    maxLength={60}
                                    required
                                    className="sm:col-span-2 p-2 border border-gray-300 rounded-md text-sm"
                                  />
                                  <select
                                    value={r.rating}
                                    onChange={(e) => updateReview(i, 'rating', Number(e.target.value))}
                                    className="p-2 border border-gray-300 rounded-md text-sm"
                                  >
                                    <option value={5}>★★★★★ 5</option>
                                    <option value={4}>★★★★☆ 4</option>
                                    <option value={3}>★★★☆☆ 3</option>
                                    <option value={2}>★★☆☆☆ 2</option>
                                    <option value={1}>★☆☆☆☆ 1</option>
                                  </select>
                                  <input
                                    type="date"
                                    value={(r.date || '').slice(0, 10)}
                                    onChange={(e) => updateReview(i, 'date', e.target.value)}
                                    className="p-2 border border-gray-300 rounded-md text-sm"
                                  />
                                  <input
                                    value={r.title || ''}
                                    onChange={(e) => updateReview(i, 'title', e.target.value)}
                                    placeholder="Title (optional)"
                                    maxLength={100}
                                    className="sm:col-span-2 p-2 border border-gray-300 rounded-md text-sm"
                                  />
                                </div>
                                <textarea
                                  value={r.body}
                                  onChange={(e) => updateReview(i, 'body', e.target.value)}
                                  placeholder="Review body"
                                  maxLength={2000}
                                  rows={3}
                                  required
                                  className="mt-2 w-full p-2 border border-gray-300 rounded-md text-sm"
                                />
                                <div className="mt-2 flex items-center justify-between text-xs">
                                  <label className="inline-flex items-center gap-2 text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={r.verified || false}
                                      onChange={(e) => updateReview(i, 'verified', e.target.checked)}
                                    />
                                    Verified purchase
                                  </label>
                                  <input
                                    value={r.orderId || ''}
                                    onChange={(e) => updateReview(i, 'orderId', e.target.value)}
                                    placeholder="Order ID (optional reference)"
                                    className="flex-1 mx-3 p-1 border border-gray-200 rounded text-xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeReview(i)}
                                    className="text-red-600 hover:text-red-800 font-medium"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={addReview}
                            className="mt-3 text-sm text-teal-700 hover:text-teal-900 font-medium"
                          >
                            + Add Review
                          </button>
                        </div>
                      </div>
                      </div>
                      <div className="px-4 sm:px-6 py-3 border-t border-gray-200 bg-gray-50 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 flex-shrink-0">
                        <button
                          type="button"
                          onClick={closeAndReset}
                          disabled={isLoading}
                          className="w-full sm:w-auto px-4 py-2 border border-gray-300 bg-white rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="w-full sm:w-auto px-4 py-2 bg-teal-700 text-white rounded-md text-sm font-medium hover:bg-teal-800 disabled:opacity-50"
                        >
                          {isLoading ? 'Saving...' : editingId ? 'Update' : 'Create'}
                        </button>
                      </div>
                    </form>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>

        {/* Delete Confirmation Modal */}
        <Transition appear show={isDeleteConfirmOpen} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setIsDeleteConfirmOpen(false)}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black bg-opacity-25" />
            </Transition.Child>

            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4 text-center">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-300"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-lg bg-white p-6 text-left align-middle shadow-xl transition-all">
                    <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                      Delete Product
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete this product? This action cannot be undone.
                      </p>
                    </div>
                    <div className="mt-6 flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => setIsDeleteConfirmOpen(false)}
                        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={isLoading}
                        className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                      >
                        {isLoading ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </div>
      {previewImage && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}>
          <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img src={previewImage} alt="Preview" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
            <button onClick={() => setPreviewImage(null)} className="absolute -top-3 -right-3 bg-white text-gray-700 rounded-full p-1.5 shadow-lg hover:bg-gray-100">
              <XMarkIcon className="h-5 w-5" />
            </button>
            {(formData.images || []).length > 1 && (() => {
              const imgs = formData.images || [];
              const idx = imgs.indexOf(previewImage);
              return (
                <>
                  {idx > 0 && (
                    <button onClick={() => setPreviewImage(imgs[idx - 1])} className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 text-gray-700 rounded-full p-2 shadow-lg hover:bg-white">
                      <ChevronLeftIcon className="h-5 w-5" />
                    </button>
                  )}
                  {idx < imgs.length - 1 && (
                    <button onClick={() => setPreviewImage(imgs[idx + 1])} className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 text-gray-700 rounded-full p-2 shadow-lg hover:bg-white">
                      <ChevronRightIcon className="h-5 w-5" />
                    </button>
                  )}
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1 rounded-full">
                    {idx + 1} / {imgs.length}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductForm;