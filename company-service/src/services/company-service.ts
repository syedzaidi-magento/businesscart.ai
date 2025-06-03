import { Company, ICompany } from '../models/company';
import { CreateCompanyInput, UpdateCompanyInput, AddCustomerInput } from '../validation';

export class CompanyService {
  async createCompany(data: CreateCompanyInput, userId: string): Promise<ICompany> {
    const company = new Company({ ...data, userId, customers: [] });
    await company.save();
    return company;
  }

  async getCompanies(userId: string): Promise<ICompany[]> {
    return await Company.find({ userId });
  }

  async getCompanyById(id: string, userId: string, userRole: string): Promise<ICompany> {
    const company = await Company.findById(id);
    if (!company) {
      throw new Error('Company not found');
    }
    if (userRole === 'company' && company.userId !== userId) {
      throw new Error('You can only access your own company');
    }
    if (userRole === 'customer' && !company.customers.includes(userId)) {
      throw new Error('You are not associated with this company');
    }
    return company;
  }

  async getCompanyByCode(code: string): Promise<ICompany | null> {
    return await Company.findOne({ companyCode: code });
  }

  async updateCompany(id: string, data: UpdateCompanyInput, userId: string): Promise<ICompany> {
    const company = await Company.findById(id);
    if (!company) {
      throw new Error('Company not found');
    }
    if (company.userId !== userId) {
      throw new Error('You can only update your own companies');
    }
    Object.assign(company, data);
    await company.save();
    return company;
  }

  async deleteCompany(id: string, userId: string): Promise<void> {
    const company = await Company.findById(id);
    if (!company) {
      throw new Error('Company not found');
    }
    if (company.userId !== userId) {
      throw new Error('You can only delete your own companies');
    }
    await company.deleteOne();
  }

  async addCustomer(companyId: string, customerId: string, userId: string): Promise<ICompany> {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error('Company not found');
    }
    if (company.userId !== userId) {
      throw new Error('You can only manage your own companies');
    }
    if (!company.customers.includes(customerId)) {
      company.customers.push(customerId);
      await company.save();
    }
    return company;
  }

  async addCustomerByCode(code: string, customerId: string): Promise<ICompany> {
    const company = await Company.findOne({ companyCode: code });
    if (!company) {
      throw new Error('Company not found');
    }
    if (!company.customers.includes(customerId)) {
      company.customers.push(customerId);
      await company.save();
    }
    return company;
  }

  async getCustomerCompanyIds(customerId: string): Promise<string[]> {
    const companies = await Company.find({ customers: customerId }).exec();
    return companies.map((company) => company._id.toString());
  }
}