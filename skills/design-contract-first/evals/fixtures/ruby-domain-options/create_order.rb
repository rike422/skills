class CreateOrder
  def call(options)
    raise ArgumentError, "customer_id is required" unless options[:customer_id]
    raise ArgumentError, "items are required" if options.fetch(:items, []).empty?

    {
      customer_id: options[:customer_id],
      items: options[:items],
      expedited: options.fetch(:expedited, false)
    }
  end
end
